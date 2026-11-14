// STATISTIC: OwnKeyWalksExpanded >= 1
function clone(start) {
  const inner = { v: start };
  const record = { get a() { inner.v = 10; return 1; }, b: inner };
  return JSON.stringify(structuredClone(record));
}
for (const n of JSON.parse("[1,2,3]")) console.log(clone(n));
