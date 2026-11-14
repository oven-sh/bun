const unseen = x => [x][JSON.parse("0")];
const holder = { f: unseen(0) ? () => 1 : undefined, g: undefined }; for (const h of [x => x, x => x + 1]) holder.g = h; holder.g = holder.g; const P0 = class { m() { return holder.g === undefined; } }, P1 = class { m() { return holder.f === undefined; } }, P2 = class { static s = 1; #p = 2; m() { return this.#p; } }; const take = (f, i) => make(f, ...[i]), show = g => g.m();
function make(C, ...a) { return new C(a[0]); }
function apply(f, ...a) { return f(a[0]); }
function run(n) { let out = ""; for (let i = 0; i < n; i++) { try { let f; switch (i % 3) { case 0: f = P0; break; case 1: f = P1; break; default: f = P2; } const got = take(f, i); out += show(got, i) + ";"; } catch (e) { out += e.constructor.name + ";"; } } return out; }
for (const n of unseen([3])) console.log(run(n));
