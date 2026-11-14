const out = [];
const log = (...values) => out.push(values.map(v => (Array.isArray(v) ? "[" + v + "]" : Object.is(v, -0) ? "-0" : String(v))).join(" "));
const ints = [3, 4, 1, 9], doubles = [1.5, -0, 2.5], texts = ["a", "b"], holes = [1, , 3], none = [], parsed = JSON.parse("[5,6,7]");
const grown = [1];
function byFor(vs) { let s = 0; const it = vs[Symbol.iterator](); for (let r = it.next(); !r.done; r = it.next()) s += Number(r.value) || 1; log(it.next().done, it.next().value); return s; }
function byWhile(vs) { let s = 0; const it = vs.values(); let r; while (!(r = it.next()).done) s = (s + (r.value | 0)) | 0; return s; }
function endless(vs) { let s = ""; const it = vs.entries(); for (;;) { const { value, done } = it.next(); if (done) break; s += value[0] + ":" + value[1] + ";"; } return s; }
function keys(vs) { let s = 0; const it = vs.keys(); for (;;) { const r = it.next(); if (r.done) return s; s += r.value * 2; } }
function growing(vs) { const it = vs.values(); let n = 0; for (let r = it.next(); !r.done && n < 12; r = it.next()) { n++; if (vs.length < 10) vs.push(n); } vs.length = 1; log(it.next().done); vs.push(7, 8, 9); return n + String(it.next().value); }
function shrinking() { const vs = [1, 2, 3, 4]; const it = vs.values(); it.next(); vs.length = 1; const r = it.next(); vs.push(5, 6); return String(r.done) + it.next().done; }
for (let round = 0; round < 3; round++) for (const vs of [ints, doubles, texts, holes, none, parsed]) log(byFor(vs), byWhile(vs), endless(vs), keys(vs));
for (let round = 0; round < 3; round++) log(growing(grown), shrinking());
let total = 0;
for (let r = 0; r < 200; r++) for (let i = 0; i < 8; i++) { const it = ints.values(); for (let q = it.next(); !q.done; q = it.next()) total = (total + q.value * i) | 0; const it2 = doubles.values(); for (;;) { const q = it2.next(); if (q.done) break; total += q.value; } }
log(total);
console.log(out.join("\n"));
