// A list that one loop fills and another drains: of every kind, refilled, read in between, handed out, with nothing left to pop.
const show = x => (Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from(x, show).join() + "]" : typeof x === "object" && x ? "{" + show(x.v) + "}" : String(x));
const kept = [];
function drained(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); let s = 0; while (q.length > 0) s += q.pop(); return [s, q]; }
function half(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); let s = 0; for (let i = 0; i < L.length >> 1; i++) s += q.pop(); return [s, q]; }
function past(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); const out = []; for (let i = 0; i < L.length + 2; i++) out.push(q.pop()); return [out, q]; }
function twice(L) { const q = []; let s = 0; for (let k = 0; k < 2; k++) { for (let i = 0; i < L.length; i++) q.push(L[i]); while (q.length > k) s += q.pop(); } return [s, q]; }
function handed(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); kept.push(q); let s = 0; while (q.length > 1) { s += q.pop(); if (q.length === 2) kept[0] = q.slice(); } return [s, q]; }
function changed(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); let s = 0; if (q.length > 1) q[1] = "x"; while (q.length > 0) s += q.pop(); return s; }
function grown(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); let s = 0, n = 0; while (q.length > 0 && n++ < 30) { const x = q.pop(); s += x; if (n % 3 === 0) q.unshift(x); } return [s, q]; }
function holed(L) { const q = [1, 2]; for (let i = 0; i < L.length; i++) q.push(i); if (q.length > 3) delete q[2]; const out = []; while (q.length > 0) out.push(q.pop()); return out; }
function objects(L) { const q = []; for (let i = 0; i < L.length; i++) q.push({ v: L[i], d: i }); let s = 0; while (q.length > 0) { const n = q.pop(); if (n.d % 3 === 0 && n.d > 0) q.push({ v: n.v + 1, d: n.d - 1 }); s += n.v; } return s; }
function search(L) { const kids = L.map((_, i) => [2 * i + 1, 2 * i + 2].filter(k => k < L.length)); const q = [0]; let s = 0; while (q.length > 0) { const n = q.pop(); s += L[n]; const k = kids[n] ?? []; for (let j = 0; j < k.length; j++) q.push(k[j]); } return s; }
const inputs = [() => [5, 3, 8, 1, 9, 2, 7], () => [1.5, 0.5, 2.5, 2, 0.25], () => [2147483647, 2147483648, -1, 4], () => [3, , 1, 2], () => ["b", "a", "c"], () => [], () => [NaN, 1, -0, 0], () => [undefined, 4, null, 2], () => Float64Array.from([3, 1.5, 2]), () => JSON.parse("[4,3,2,1]"), () => JSON.parse("[4.5,3]"), () => [7]];
for (let turn = 0; turn < 4; turn++)
  for (const input of inputs)
    for (const run of [drained, half, past, twice, handed, changed, grown, holed, objects, search]) {
      let said;
      try { const list = input(); said = show(run(run === search ? Array.from(list) : list)); } catch (e) { said = "!" + e.constructor.name; }
      console.log(run.name, said.slice(0, 100));
      if (kept.length > 4) kept.length = 0;
    }
