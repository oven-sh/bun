const unseen = x => [x][JSON.parse("0")];
class P0 { constructor(w) { this.self = this; this.w = w; } m() { return this.self === this; } } class P1 { constructor(w) { this.w = w; this.next = this; } m() { return 1; } } function P2(w) { this.w = w; } P2.prototype.m = function () { return this.w; }; const take = (f, i) => make(f, ...[i]), show = g => g.w + typeof g.m;
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
