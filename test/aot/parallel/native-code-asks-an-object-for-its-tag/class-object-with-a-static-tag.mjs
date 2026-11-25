class C { static n = 1; static get [Symbol.toStringTag]() { this.n = "text"; return "C"; } }
function read(o) { return o.n + 1; }
const k = C;
const out = [read(k)];
let got; try { got = Object.prototype.toString.call(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
