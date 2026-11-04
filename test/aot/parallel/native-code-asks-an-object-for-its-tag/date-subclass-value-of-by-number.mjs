class D extends Date { constructor() { super(0); this.n = 1; } valueOf() { this.n = "text"; return 5; } }
function read(o) { return o.n + 1; }
const k = new D();
const out = [read(k)];
let got; try { got = Number(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
