class K { constructor(n) { this.n = n; this.m = 2; } then(resolve) { this.n = "text"; resolve(7); } }
function read(o) { return o.n + 1; }
const k = new K(1);
const out = [read(k), read(new K(5))];
async function go() { let got; try { got = await (async () => k)(); } catch (error) { got = error.name; }
out.push(String(got), read(k), read(new K(5)), Object.keys(k).join());
console.log(out.join(" | ")); }
go();
