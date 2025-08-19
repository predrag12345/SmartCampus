// -----------------------
// MOCK PODACI + UTIL
// -----------------------
const HOURS = 24;                 // poslednja 24h
const TICK_MS = 5000;             // "real-time" dopuna na 5s
const devices = { dev1: {}, dev2: {} };
const params = [
  { key:'temp',  label:'Temperatura', unit:'°C',  min:18, max:30 },
  { key:'press', label:'Pritisak',    unit:'hPa', min:980, max:1030 },
  { key:'hum',   label:'Vlažnost',    unit:'%',   min:35, max:75 }
];

function seededRand(seed){
  // jednostavan LCG radi determinističnog mocka po uređaju
  let x = seed % 2147483647; return ()=> (x = x * 48271 % 2147483647) / 2147483647;
}

function genSeries(seed, base, drift, noise){
  const rand = seededRand(seed);
  const out = [];
  let v = base + (rand()-0.5)*2*drift;
  for(let i=0;i<HOURS;i++){
    v += (rand()-0.5)*drift; // blagi hod
    const n = (rand()-0.5)*noise;
    out.push(Number((v+n).toFixed(2)));
  }
  return out;
}

function buildMock(){
  devices.dev1 = {
    temp:  genSeries(11, 24, 0.6, 0.8),
    press: genSeries(12,1005, 1.5, 2.0),
    hum:   genSeries(13, 55, 1.2, 2.5)
  };
  devices.dev2 = {
    temp:  genSeries(21, 22, 0.7, 1.0),
    press: genSeries(22,1000, 2.0, 3.0),
    hum:   genSeries(23, 60, 1.1, 2.0)
  };
}

// -----------------------
// PRAGOVI (LocalStorage)
// -----------------------
const TH_KEY = 'smartcampus.thresholds.v1';
function loadThresholds(){
  const saved = JSON.parse(localStorage.getItem(TH_KEY) || 'null');
  if(saved) return saved;
  // default
  const obj = {}; params.forEach(p=>obj[p.key]={min:p.min,max:p.max});
  return obj;
}
function saveThresholds(obj){ localStorage.setItem(TH_KEY, JSON.stringify(obj)); }

// -----------------------
// CANVAS CHART
// -----------------------
function drawChart(canvas, values, th){
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth*2;  // hi‑dpi
  const H = canvas.height = canvas.clientHeight*2;
  ctx.clearRect(0,0,W,H);

  const pad = 40; // leva margina za ose
  const plotW = W - pad - 10; const plotH = H - pad - 20;

  const minVal = Math.min(...values, th.min)-Math.abs(th.min)*0.05;
  const maxVal = Math.max(...values, th.max)+Math.abs(th.max)*0.05;
  const y = v => pad + plotH - (v - minVal) / (maxVal - minVal) * plotH;
  const x = i => pad + (i/(values.length-1))*plotW;

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1; ctx.beginPath();
  for(let i=0;i<=6;i++){ const gy = pad + i*(plotH/6); ctx.moveTo(pad,gy); ctx.lineTo(W-10,gy); }
  ctx.stroke();

  // threshold zone (green band)
  ctx.fillStyle = 'rgba(112, 255, 195, 0.10)';
  const yMin = y(th.max), yMax = y(th.min);
  ctx.fillRect(pad, yMin, plotW, yMax-yMin);
  // threshold lines
  ctx.strokeStyle = 'rgba(255, 200, 0, .6)'; ctx.setLineDash([8,6]);
  ctx.beginPath(); ctx.moveTo(pad,y(th.min)); ctx.lineTo(W-10,y(th.min)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad,y(th.max)); ctx.lineTo(W-10,y(th.max)); ctx.stroke();
  ctx.setLineDash([]);

  // line path
  ctx.lineWidth = 3; ctx.strokeStyle = '#50b4ff';
  ctx.beginPath(); values.forEach((v,i)=>{ const xx=x(i), yy=y(v); if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy); });
  ctx.stroke();

  // points (red if out of range)
  values.forEach((v,i)=>{
    const out = (v < th.min || v > th.max);
    ctx.fillStyle = out ? '#ff6b6b' : '#6ee7b7';
    ctx.beginPath(); ctx.arc(x(i), y(v), 5, 0, Math.PI*2); ctx.fill();
  });

  // axes labels (crude)
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(maxVal.toFixed(1), 4, y(maxVal));
  ctx.fillText(minVal.toFixed(1), 4, y(minVal));
  ctx.fillText('−24h', pad, H-8); ctx.fillText('sada', W-64, H-8);
}

// -----------------------
// UI POVEZIVANJE
// -----------------------
const els = {
  deviceSel: document.getElementById('deviceSel'),
  chartTemp: document.getElementById('chart-temp'),
  chartPress: document.getElementById('chart-press'),
  chartHum: document.getElementById('chart-hum'),
  overall: document.getElementById('overall'),
  alerts: document.getElementById('alerts'),
  kpi: document.getElementById('kpi'),
  saveBtn: document.getElementById('saveBtn'),
  defaultsBtn: document.getElementById('defaultsBtn'),
  resetBtn: document.getElementById('resetBtn'),
  inputs: {
    temp: { min: document.getElementById('min-temp'), max: document.getElementById('max-temp') },
    press:{ min: document.getElementById('min-press'),max: document.getElementById('max-press')},
    hum:  { min: document.getElementById('min-hum'),  max: document.getElementById('max-hum') }
  }
};

let thresholds = loadThresholds();

function fillInputs(){
  params.forEach(p=>{
    els.inputs[p.key].min.value = thresholds[p.key].min;
    els.inputs[p.key].max.value = thresholds[p.key].max;
  });
}

function readInputs(){
  params.forEach(p=>{
    const min = parseFloat(els.inputs[p.key].min.value);
    const max = parseFloat(els.inputs[p.key].max.value);
    thresholds[p.key] = {min,max};
  });
}

function updateKPI(d){
  const nowIdx = d.temp.length-1;
  const items = [
    {k:'temp', label:'Temp', unit:'°C'},
    {k:'press',label:'Pritisak',    unit:'hPa'},
    {k:'hum',  label:'Vlažnost',    unit:'%'}
  ];
  els.kpi.innerHTML = items.map(it=>{
    const v = d[it.k][nowIdx]; const th = thresholds[it.k];
    const ok = (v>=th.min && v<=th.max);
    return `<div class="item"><div class="lbl">${it.label} </div><div class="val">${v} ${it.unit}</div><div class="${ok?'status ok':'status bad'}">${ok?'OK':'IZVAN GRANICA'}</div></div>`;
  }).join('');
}

function updateOverall(d){
  const idx = d.temp.length-1;
  const bad = params.some(p=> d[p.key][idx] < thresholds[p.key].min || d[p.key][idx] > thresholds[p.key].max );
  els.overall.className = 'status ' + (bad?'bad':'ok');
  els.overall.textContent = bad? '⚠️ UPOZORENJE: neki parametri su izvan granica' : '✅ Sistem u normali';
}

function pushAlert(text, severity='bad'){
  const div = document.createElement('div');
  div.className = 'pill ' + (severity==='warn'?'warn':'bad');
  div.textContent = new Date().toLocaleTimeString() + ' — ' + text;
  els.alerts.prepend(div);
}

function redraw(){
  const dev = els.deviceSel.value; const d = devices[dev];
  drawChart(els.chartTemp,  d.temp,  thresholds.temp);
  drawChart(els.chartPress, d.press, thresholds.press);
  drawChart(els.chartHum,   d.hum,   thresholds.hum);
  updateKPI(d); updateOverall(d);
}

function simulateRealtime(){
  // svakih 5s dodajemo novu vrednost i uklanjamo najstariju
  const devKeys = Object.keys(devices);
  devKeys.forEach(key=>{
    const d = devices[key];
    // lagane promene
    d.temp.push( +(d.temp.at(-1) + (Math.random()-0.5)).toFixed(2) ); d.temp.shift();
    d.press.push( +(d.press.at(-1) + (Math.random()-0.5)*2).toFixed(1) ); d.press.shift();
    d.hum.push( +(d.hum.at(-1) + (Math.random()-0.5)*1.5).toFixed(1) ); d.hum.shift();

    // alarmi ako pređe granice (samo za izabrani uređaj da ne zatrpava)
    if(key===els.deviceSel.value){
      const idx = d.temp.length-1;
      if(d.temp[idx]  < thresholds.temp.min  ) pushAlert('Temperatura je preniska');
      if(d.temp[idx]  > thresholds.temp.max  ) pushAlert('Temperatura je previsoka');
      if(d.hum[idx]   < thresholds.hum.min   ) pushAlert('Vlažnost je preniska');
      if(d.hum[idx]   > thresholds.hum.max   ) pushAlert('Vlažnost je previsoka');
      if(d.press[idx] < thresholds.press.min ) pushAlert('Pritisak je nizak','warn');
      if(d.press[idx] > thresholds.press.max ) pushAlert('Pritisak je visok','warn');
    }
  });
  redraw();
}

// -----------------------
// INIT
// -----------------------
function setDefaults(){
  thresholds = {}; params.forEach(p=>thresholds[p.key]={min:p.min,max:p.max});
  fillInputs(); saveThresholds(thresholds); redraw();
}

document.addEventListener('DOMContentLoaded', ()=>{
  buildMock(); fillInputs(); redraw();
  els.deviceSel.addEventListener('change', redraw);
  els.saveBtn.addEventListener('click', ()=>{ readInputs(); saveThresholds(thresholds); redraw(); });
  els.defaultsBtn.addEventListener('click', setDefaults);
  els.resetBtn.addEventListener('click', ()=>{ buildMock(); redraw(); });
  setInterval(simulateRealtime, TICK_MS);
});