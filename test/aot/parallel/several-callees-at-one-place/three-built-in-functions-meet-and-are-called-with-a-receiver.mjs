const unseen = x => [x][JSON.parse("0")];
const P0 = Math.max, P1 = String.prototype.trim, P2 = Object.prototype.hasOwnProperty, r = [null, " a ", [1]]; const take = (f, i) => f.call(r[i], "length"), show = g => String(g);
Object.defineProperty(r, JSON.parse('"q"'), { get: () => P0 }); console.log(r.q === Math.max);
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
