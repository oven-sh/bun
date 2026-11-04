class K { constructor(n) { this.n = n; } toString() { this.n = "text"; return "K"; } }
function read(o) { return o.n + 1; }
const k = new K(1);
const out = [read(k)];
out.push(Object.prototype.toLocaleString.call(k), [k].toLocaleString(), k.toLocaleString(), read(k));
console.log(out.join(" | "));
