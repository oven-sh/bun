class E extends Error { constructor() { super(); this.n = 1; } get message() { this.n = "text"; return "M"; } }
function read(o) { return o.n + 1; }
const k = new E();
const out = [read(k)];
let got; try { got = String(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
