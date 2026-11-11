const unseen = x => [x][JSON.parse("0")];
class B0 { constructor(n) { this.k = n; } m() { return "b" + this.k; } un() { return "u"; } } const mix = P => class extends P { m() { return "x" + super.m(); } }; const P0 = mix(B0), P1 = mix(B0); class P2 extends B0 { m() { return "z" + super.m(); } } const take = (f, i) => make(f, ...[i]), show = g => g.m();
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
