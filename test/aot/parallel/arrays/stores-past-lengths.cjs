// STATISTIC: StoresPastLengthEmittedInline >= 3
// Stores past the length of arrays made here, inside their storage, that leave holes: ints, fractions, any values; and what reads, counts and grows behind them.
function pairs(n, other) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows[i] = [];
    rows[i][1] = i;
    rows[i][0] = other ? other[i % other.length] : i * 2;
  }
  return rows;
}
function gaps(n, at, values) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    row[at] = values[i % values.length];
    if (i % 3) row[at + 2] = i;
    if (i % 5 === 0) row[0] = -i;
    rows.push(row);
  }
  return rows;
}
function grown(n) {
  const a = [0.5];
  for (let i = 2; i < n; i += 3) a[i] = i / 2;
  return a;
}
function filled(n) {
  const a = new Array(n);
  for (let i = n - 1; i >= 0; i -= 2) a[i] = i;
  a[n + 1] = n;
  return a;
}
function inner(n) {
  const grid = [];
  for (let y = 0; y < n; y++) {
    grid[y] = [];
    for (let x = n; x >= 0; x--) grid[y][x] = x * y;
  }
  return grid;
}
const show = a => a.length + ":" + Array.from(a, (e, i) => (i in a ? (Object.is(e, -0) ? "-0" : Array.isArray(e) ? "[" + show(e) + "]" : typeof e + String(e)) : "_")).join();
const out = [];
for (let round = 0; round < 3; round++) {
  out.push(show(pairs(6)), show(pairs(6, [1.5, -0, NaN, undefined, "x", null, {}])), show(pairs(6, [2 ** 31, -1])));
  for (const at of [0, 1, 2, 3, 4, 7]) out.push(show(gaps(7, at, [1, 2.5, "s"])), show(gaps(7, at, [1])), show(gaps(7, at, [0.25, NaN])), show(gaps(7, at, [undefined])));
  out.push(show(grown(14)), show(filled(9)), show(inner(5)));
  const rows = pairs(4);
  rows[2].push(9);
  rows[3][5] = 1;
  rows[3].length = 3;
  rows[3][4] = 2;
  out.push(show(rows), rows[3].indexOf(undefined) + "," + rows[3].includes(undefined) + "," + Object.keys(rows[3]).join() + "," + rows[3].reduce((s, v) => s + v));
}
console.log(out.join("\n"));
