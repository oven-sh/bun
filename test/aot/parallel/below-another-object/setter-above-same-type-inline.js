class V { constructor(i) { this.from = "here" + i; this.gone = i; } }
const created = Object.create({ set slot(v) { v.from = "changed"; v.gone = v.gone + 100; } });
let out = ""; for (let i = 0; i < 3; i++) { const v = new V(i); const a = v.gone; created.slot = v; out += a + " " + v.gone + " " + v.from + ";"; } console.log(out);
