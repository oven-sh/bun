function f() {}
f.n = 1;
Object.defineProperty(f, Symbol.toStringTag, { get() { this.n = "text"; return "F"; } });
function read(o) { return o.n + 1; }
const k = f;
const out = [read(k)];
let got; try { got = Object.prototype.toString.call(k); } catch (error) { got = error.name; }
out.push(String(got), read(k));
console.log(out.join(" | "));
