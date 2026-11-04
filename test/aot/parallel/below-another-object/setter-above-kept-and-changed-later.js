class V { constructor(i) { this.from = "here" + i; this.gone = i; } }
let kept = null;
const created = Object.create({ set slot(v) { kept = v; } });
function store(o, v) { o.slot = v; }
function later() { kept.from = "later"; kept.gone = -1; }
function run(i) { const v = new V(i); store(created, v); const a = v.from; later(); return a + " " + v.from + " " + v.gone; }
let out = ""; for (let i = 0; i < 3; i++) out += run(i) + ";"; console.log(out);
