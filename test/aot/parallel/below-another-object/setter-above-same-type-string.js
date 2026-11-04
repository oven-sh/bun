class V { constructor(i) { this.from = "here" + i; this.gone = i; } }
const above = { set slot(v) { v.from = "changed"; v.gone = v.gone + 100; } };
const created = Object.create(above);
function store(o, v) { o.slot = v; }
function run(i) { const v = new V(i); const before = v.from + v.gone; store(created, v); return before + " " + v.from + " " + v.gone + " " + v.from.length; }
let out = ""; for (let i = 0; i < 3; i++) out += run(i) + ";"; console.log(out);
