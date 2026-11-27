// STATISTIC: OwnKeyWalksExpanded >= 1
function list(start) {
  const record = { a: start, get b() { record.c = 10; return 2; }, c: 3 };
  return JSON.stringify(Object.entries(record)) + JSON.stringify(Object.values(record)) + JSON.stringify(Object.fromEntries(Object.entries(record)));
}
for (const n of JSON.parse("[1,2,3]")) console.log(list(n));
