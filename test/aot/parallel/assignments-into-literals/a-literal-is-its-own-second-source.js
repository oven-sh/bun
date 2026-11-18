// STATISTIC: OwnKeyWalksExpanded >= 1
// Object.assign(t, s, t): by the time t is read as a source it holds what s brought.
// STATISTIC: ObjectAssignCallsExpanded >= 1
function place(n) {
  const t = { a: n, b: n + 1 };
  const s = { a: n * 10 };
  Object.assign(t, s, t);
  return t.a + " " + t.b;
}
// The sources are written in the call: each field of theirs is a store.
function placeWritten(n) {
  const t = { a: n, b: n + 1 };
  Object.assign(t, { a: n * 10 }, t);
  return t.a + " " + t.b;
}
for (const n of JSON.parse("[1,2,3]")) console.log(place(n), placeWritten(n));
