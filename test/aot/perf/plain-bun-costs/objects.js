let sum = 0;
class Point { constructor(x, y) { this.x = x; this.y = y; } get length() { return this.x + this.y; } }
for (let i = 0; i < 60000; i++) {
  const made = { id: i, name: "n" + (i & 63), tags: [i, i + 1], inner: { a: 1, b: i } };
  made.later = i; made["k" + (i & 15)] = i;
  const copy = { ...made, extra: true };
  const merged = Object.assign({}, copy, { id: -i });
  delete merged.later;
  for (const key in merged) sum += key.length;
  sum += Object.keys(copy).length + Object.entries(made.inner).length + new Point(i, 1).length;
  if ("name" in merged && Object.hasOwn(merged, "extra")) sum++;
}
const table = {};
for (let i = 0; i < 40000; i++) table["key" + i] = i;
for (let i = 0; i < 40000; i += 3) delete table["key" + i];
for (const key in table) sum += table[key];
const frozen = Object.freeze({ a: 1, b: [1, 2, 3] });
for (let i = 0; i < 100000; i++) sum += frozen.a + frozen.b[i % 3] + Reflect.ownKeys(frozen).length;
console.log(sum);
