function hit(x) { return x + 1; }
const K = JSON.parse('["late", 3]');
const first = { a: 1 }, all = [first, { b: 1 }, { c: 1 }, { d: 1 }, { e: 1 }, { f: 1 }, { g: 1 }];
function lay(t) { t.late = hit; }
function run(t, k, x) { const f = t[k]; return f(x); }
const out = [hit(1)];
for (let i = 0; i < all.length; i++) lay(all[i]);
out.push(run(first, K[0], "s"), hit(2), typeof all[K[1]].late);
console.log(out.join());
