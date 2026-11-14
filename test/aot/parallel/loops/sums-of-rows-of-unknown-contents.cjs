// STATISTIC: ArraysGuardedInIterations >= 4
// Elements of rows that are added to a sum that starts as a number are expected to be numbers, though nobody knows what the rows hold. Texts, bigints, holes, rows of every kind and rows that change in the meantime give the answers of the written loop.
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, (x, i) => (i in value ? show(x) : "!")).join() + "]" + value.length : typeof value === "bigint" ? value + "n" : String(value));
function means(rows, n) {
  const out = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < rows.length; i++) s += rows[i][j];
    out.push(s / rows.length);
  }
  return out;
}
function column(rows, n) {
  let s = 0.5;
  for (let i = 0; i < rows.length; i++) s += rows[i][n - 1];
  return s;
}
function all(rows, n) {
  let s = 0;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < n; j++) s += rows[i][j];
  return s;
}
function scaled(rows, n) {
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < n; j++) rows[i][j] = rows[i][j] + rows[i][0];
  return rows;
}
function texts(rows, n) {
  let s = "";
  for (let i = 0; i < rows.length; i++) s += rows[i][n - 1];
  return s;
}
const rows = (n, m, f) => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(i, j)));
const makes = [(i, j) => Math.sin(i * 7 + j * 3 + 1), (i, j) => i * 3 - j, (i, j) => (j === 2 ? NaN : i - j / 2), (i, j) => (i === 2 && j === 1 ? "x" + j : -0), (i, j) => (i === 1 ? 5n : j), (i, j) => (i === 3 ? null : j / 4), (i, j) => 1e308 * (j + 1)];
const changes = [
  () => {},
  a => { a[1] = undefined; },
  a => { delete a[0][2]; },
  a => { a[2] = new Float64Array([1, 2, 3, 4, 5]); },
  a => { a[1] = "12345"; },
  a => { a[0].length = 1; },
  a => { let t = 0; Object.defineProperty(a[1], 2, { get() { a[2] = [t++, 2, 3, 4, "y"]; return 4; } }); },
  a => { a[2] = { 0: 1, 1: { valueOf() { a.length = 3; return 2; } }, 2: 3, 3: 4, 4: 5 }; },
  a => { a[3] = a[1]; },
];
let a;
const table = { means: () => means(a, 5), column: () => column(a, 5), all: () => all(a, 5), scaled: () => scaled(a, 5), texts: () => texts(a, 5) };
globalThis["sums" + process.pid] = table;
for (const name of Object.keys(table)) {
  const line = [];
  for (const change of changes) {
    let hash = 0;
    for (const make of makes) {
      a = rows(5, 5, make);
      change(a);
      let text = "";
      for (let turn = 0; turn < 3; turn++) {
        try {
          text += show(table[name]());
        } catch (error) {
          text += error.name;
        }
      }
      text += show(a[1]) + a.length;
      for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0;
    }
    line.push(hash);
  }
  console.log(name, line.join());
}
