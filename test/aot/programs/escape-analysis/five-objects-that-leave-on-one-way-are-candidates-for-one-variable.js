// Five small objects. Each is handed out on one rare way of its own, and one of them is picked at the end. None has more than two forms anywhere: made, or not made yet.
// TODO: the build counts 16: STATISTIC: MaxVirtualObjectVariantsHits = 0
const kept = [];
function keep(o) {
  kept.push(o);
  if (kept.length > 4) kept.length = 0;
}
function five(a, b, c, d, e, k) {
  const p = { x: a }, q = { x: b }, r = { x: c }, s = { x: d }, t = { x: e };
  if (a > 1000) keep(p);
  if (b > 1000) keep(q);
  if (c > 1000) keep(r);
  if (d > 1000) keep(s);
  if (e > 1000) keep(t);
  const w = k === 0 ? p : k === 1 ? q : k === 2 ? r : k === 3 ? s : t;
  return w.x + p.x + q.x + r.x + s.x + t.x;
}
let total = 0;
for (let i = 0; i < 30000; i++) total += five(i % 1003, i % 1009, i % 1013, i % 1019, i % 1021, i % 5);
console.log(total, kept.length, kept.map(o => o.x).join());
