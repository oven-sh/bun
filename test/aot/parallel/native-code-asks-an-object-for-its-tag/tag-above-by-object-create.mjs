const above = { get [Symbol.toStringTag]() { this.n = "text"; return "K"; } };
function read(o) { return o.n + 1; }
const k = Object.assign(Object.create(above), { n: 1 });
const out = [read(k)];
let got; try { got = String(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
