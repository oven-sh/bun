
function read(o) { return o.n + 1; }
const k = { n: 1, get [Symbol.toStringTag]() { this.n = "text"; return "K"; } };
const out = [read(k)];
let got; try { got = String(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
