class R extends RegExp { constructor() { super("a"); this.n = 1; } get source() { this.n = "text"; return "s"; } }
function read(o) { return o.n + 1; }
const k = new R();
const out = [read(k)];
let got; try { got = String(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
