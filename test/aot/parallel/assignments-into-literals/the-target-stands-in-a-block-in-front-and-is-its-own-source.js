// STATISTIC: OwnKeyWalksExpanded >= 1
// The target keeps its name: only what the assignment gives back is read behind it.
// STATISTIC: ObjectAssignCallsExpanded >= 1
function place(n) {
  const t = { a: n, b: n + 1 };
  if (n < 0) return "none";
  const s = { a: n * 10 };
  const r = Object.assign(t, s, t);
  return r.a + " " + r.b;
}
// The sources are written in the call: each field of theirs is a store.
function placeWritten(n) {
  const t = { a: n, b: n + 1 };
  if (n < 0) return "none";
  const r = Object.assign(t, { a: n * 10 }, t);
  return r.a + " " + r.b;
}
for (const n of JSON.parse("[1,2,3]")) console.log(place(n), placeWritten(n));
