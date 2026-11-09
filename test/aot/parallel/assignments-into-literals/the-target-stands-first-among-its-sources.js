// A control: the target stands first among its sources.
function place(n) {
  const t = { a: n, b: n + 1 };
  Object.assign(t, t, { a: n * 10 });
  return t.a + " " + t.b;
}
for (const n of JSON.parse("[1,2,3]")) console.log(place(n));
