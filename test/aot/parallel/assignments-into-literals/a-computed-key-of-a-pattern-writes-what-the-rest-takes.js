function take(start) {
  const record = { a: start, b: 2, c: 3 };
  const key = { toString() { record.a = 10; return "c"; } };
  const { [key]: taken, ...others } = record;
  return taken + "/" + others.a + "/" + others.b;
}
for (const n of JSON.parse("[1,2,3]")) console.log(take(n));
