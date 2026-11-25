class V { constructor(i) { this.from = "here" + i; this.gone = i; } }
const created = Object.create({ set slot(v) { v.from = [1, 2, 3]; } });
function store(o, v) { o.slot = v; }
function run(i) { const v = new V(i); store(created, v); return typeof v.from + " " + v.from.length + " " + Array.isArray(v.from); }
let out = ""; for (let i = 0; i < 3; i++) out += run(i) + ";"; console.log(out);
