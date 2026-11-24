// STATISTIC: OwnKeyWalksExpanded >= 1
function take(start) {
  const record = { a: start, b: 2, c: undefined };
  globalThis.last = record;
  const { c = (globalThis.last.a = 10, 5), ...others } = record;
  return c + "/" + others.a + "/" + others.b;
}
for (const n of JSON.parse("[1,2,3]")) console.log(take(n));
