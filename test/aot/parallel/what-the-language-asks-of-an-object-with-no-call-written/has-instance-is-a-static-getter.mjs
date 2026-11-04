class K { constructor(n) { this.n = n; this.m = 2; } static get [Symbol.hasInstance]() { k.n = "text"; return () => true; } }
function read(o) { return o.n + 1; }
const k = new K(1);
const out = [read(k), read(new K(5))];
let got; try { got = k instanceof K; } catch (error) { got = error.name; }
out.push(String(got), read(k), read(new K(5)), Object.keys(k).join());
console.log(out.join(" | "));
