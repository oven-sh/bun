function text(start) {
  const inner = { v: start };
  const record = { a: { toJSON() { inner.v = 10; record.c = 20; return 1; } }, b: inner, c: 3 };
  return JSON.stringify(record);
}
for (const n of JSON.parse("[1,2,3]")) console.log(text(n));
