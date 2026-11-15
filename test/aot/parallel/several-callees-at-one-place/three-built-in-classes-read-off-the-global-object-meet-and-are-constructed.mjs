const unseen = x => [x][JSON.parse("0")];
const pick = (o, i) => (i === 0 ? o.Map : i === 1 ? o.Set : o.WeakMap); const P0 = pick(globalThis, 0), P1 = pick(globalThis, 1), P2 = pick(globalThis, 2); const take = f => make(f, ...[undefined]), show = g => typeof g.get + typeof g.add;
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
