// steps taken by hand: two steps of one place, of two places, of two generators
const out = [];
function say(...a) { out.push(a.map(String).join(" ")); }
function* count(n) { for (let i = 0; i < n; i++) yield i; return "end"; }
function* echo() { let v = 0; for (;;) v = yield v * 2; }
function twoAStep(n) { const g = count(n); let s = 0; for (;;) { const a = g.next(); if (a.done) break; const b = g.next(); s += a.value * 10; if (b.done) break; s += b.value; } return s; }
function sameLine(n) { const g = count(n); let s = 0; for (;;) { const a = g.next(), b = g.next(); if (a.done || b.done) return s + ":" + a.value + ":" + b.value; s += a.value - b.value; } }
function twoGenerators(n, m) { const g = count(n), h = count(m); let s = ""; for (;;) { const a = g.next(), b = h.next(); if (a.done && b.done) return s; s += (a.done ? "-" : a.value) + "" + (b.done ? "-" : b.value) + ","; } }
function swapped(n) { let g = count(n), h = count(n + 2), s = 0; for (let i = 0; i < n * 3; i++) { const r = g.next(); if (!r.done) s += r.value; const t = g; g = h; h = t; } return s; }
function chosen(n, which) { const g = count(n), h = count(n * 2); let s = 0; for (let i = 0; i < n * 2; i++) { const r = (which(i) ? g : h).next(); if (!r.done) s += r.value; } return s; }
function given(n) { const g = echo(); g.next(); let s = 0; for (let i = 0; i < n; i++) s += g.next(i).value; return s; }
function helper(g) { return g.next(); }
function throughAHelper(n) { const g = count(n); let s = 0; for (;;) { const a = helper(g); if (a.done) return s + a.value; const b = helper(g); if (b.done) return s + "/" + b.value; s += a.value + b.value; } }
function afterTheEnd(n) { const g = count(n); let r; for (let i = 0; i < n + 3; i++) r = g.next(); return JSON.stringify(r); }
function whileStep(n) { const g = count(n); let r, s = 0; while (!(r = g.next()).done) s += r.value; return s + r.value; }
function stepsInsideForOf(n) { const g = count(n); let s = 0; for (const v of g) { s += v; const r = g.next(); if (!r.done) s += r.value * 100; } return s; }
function reentered() { let g; function* self() { try { yield g.next(); } catch (e) { yield e.constructor.name; } } g = self(); return g.next().value; }
function kept(n) { const g = count(n), rs = []; for (let i = 0; i <= n; i++) rs.push(g.next()); return rs.map(r => r.value + ":" + r.done).join() + (rs[0] === rs[1]); }
function all() { return [twoAStep(7), twoAStep(8), sameLine(5), sameLine(6), twoGenerators(2, 4), swapped(4), chosen(4, i => i % 2), chosen(4, i => i % 3 == 0), given(6), throughAHelper(5), throughAHelper(6), afterTheEnd(2), whileStep(5), stepsInsideForOf(7), reentered(), kept(3)].join(" | "); }
let r; for (let i = 0; i < 300; i++) r = all();
say(r);
console.log(out.join("\n"));
