class D extends Date { constructor() { super(0); this.n = 1; } toISOString() { this.n = "text"; return "iso"; } }
function read(o) { return o.n + 1; }
const k = new D();
const out = [read(k)];
let got; try { got = JSON.stringify(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
