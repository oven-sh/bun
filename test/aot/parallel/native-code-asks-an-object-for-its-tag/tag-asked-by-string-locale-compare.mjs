class K { constructor(n) { this.n = n; } get [Symbol.toStringTag]() { this.n = "text"; return "K"; } }
function read(o) { return o.n + 1; }
const k = new K(1);
const out = [read(k)];
let got; try { got = "a".localeCompare(k) !== 0; } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
