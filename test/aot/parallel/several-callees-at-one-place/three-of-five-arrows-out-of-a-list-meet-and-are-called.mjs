const unseen = x => [x][JSON.parse("0")];
const more = [x => x + 1, x => x + 2, x => x + 3, x => x + 4, x => x + 5]; const P0 = more[unseen(0)], P1 = more[unseen(1)], P2 = more[unseen(4)]; const take = (f, i) => apply(f, ...[i]), show = g => g;
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
