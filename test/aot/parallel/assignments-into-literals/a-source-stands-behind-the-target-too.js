// STATISTIC: OwnKeyWalksExpanded >= 1
// The target stands between two other sources.
// STATISTIC: ObjectAssignCallsExpanded >= 1
function place(n) {
  const t = { a: n, b: n + 1 };
  const s = { a: n * 10 };
  const u = { b: n * 100 };
  Object.assign(t, s, t, u);
  return t.a + " " + t.b;
}
// The sources are written in the call: each field of theirs is a store.
function placeWritten(n) {
  const t = { a: n, b: n + 1 };
  Object.assign(t, { a: n * 10 }, t, { b: n * 100 });
  return t.a + " " + t.b;
}
for (const n of JSON.parse("[1,2,3]")) console.log(place(n), placeWritten(n));
