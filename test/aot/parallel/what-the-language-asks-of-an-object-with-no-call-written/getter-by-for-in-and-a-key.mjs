class K { constructor(n) { this.n = n; this.m = 2; Object.defineProperty(this, "g", { enumerable: true, configurable: true, get() { this.n = "text"; return 7; } }); }  }
function read(o) { return o.n + 1; }
const k = new K(1);
const out = [read(k), read(new K(5))];
let got; try { got = (() => { let s = 0; for (const key in k) s += typeof k[key] === "number" ? 1 : 0; return s; })(); } catch (error) { got = error.name; }
out.push(String(got), read(k), read(new K(5)), Object.keys(k).join());
console.log(out.join(" | "));
