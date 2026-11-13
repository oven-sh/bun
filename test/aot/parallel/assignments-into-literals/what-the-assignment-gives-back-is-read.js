// STATISTIC: OwnKeyWalksExpanded >= 1
// What Object.assign(t, s, t) gives back is t, and t holds what s brought.
// STATISTIC: ObjectAssignCallsExpanded >= 1
function place(n) {
  const t = { a: n, b: n + 1 };
  const s = { a: n * 10 };
  const r = Object.assign(t, s, t);
  return r.a + " " + r.b + " " + (r === t);
}
// The sources are written in the call: each field of theirs is a store.
function placeWritten(n) {
  const t = { a: n, b: n + 1 };
  const r = Object.assign(t, { a: n * 10 }, t);
  return r.a + " " + r.b + " " + (r === t);
}
for (const n of JSON.parse("[1,2,3]")) console.log(place(n), placeWritten(n));
