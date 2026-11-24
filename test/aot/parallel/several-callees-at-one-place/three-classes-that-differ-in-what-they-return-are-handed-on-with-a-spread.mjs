const unseen = x => [x][JSON.parse("0")];
class P0 { k = 1; constructor(n) { this.t = new.target === P0; } m() { return 1; } } class P1 { constructor(n) { return { k: n, m: () => n }; } m() { return 2; } } class P2 { constructor(n) { if (n === 5) throw new RangeError("D"); } get g() { return 3; } } const take = (f, i) => make(f, ...[i]), show = g => typeof g + typeof g.m;
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
