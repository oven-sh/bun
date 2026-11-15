// STATISTIC: OwnKeyWalksExpanded >= 1
// The source in front is a parameter whose keys are asked.
// STATISTIC: ObjectAssignCallsExpanded >= 1
function place(s, n) {
  const t = { a: n, b: n + 1 };
  Object.assign(t, s, t);
  return t.a + " " + t.b;
}
let last = "";
for (let i = 0; i < 60; i++) last = place({ a: i * 10 }, i);
console.log(last);
for (const n of JSON.parse("[1,2,3]")) console.log(place({ a: n * 10 }, n));
