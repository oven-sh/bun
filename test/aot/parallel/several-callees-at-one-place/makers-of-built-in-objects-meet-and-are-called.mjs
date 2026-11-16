const unseen = x => [x][JSON.parse("0")];
const P0 = () => Buffer.from("ab"), P1 = () => new Set([1]), P2 = () => Promise.resolve(Promise.resolve(3)); const take = f => apply(f, ...[]), show = g => typeof g.toString + typeof g.union + typeof g.then + (g instanceof Uint8Array);
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
