class K { constructor(n) { this.n = n; this.m = 2; } get then() { this.n = "text"; return undefined; } }
function read(o) { return o.n + 1; }
const k = new K(1);
const out = [read(k), read(new K(5))];
async function go() { let got; try { got = (await k) === k; } catch (error) { got = error.name; }
out.push(String(got), read(k), read(new K(5)), Object.keys(k).join());
console.log(out.join(" | ")); }
go();
