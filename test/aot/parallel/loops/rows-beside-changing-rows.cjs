// STATISTIC: ArrayRowsHoisted >= 4
// Rows that stay the same in a loop are found before it though other rows change: c[i][j] += a[i][k] * b[k][j]. The store may go to any of them, and rows of every kind, missing, short, shared and frozen rows give the answers of the written loop.
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" + value.length : String(value));
const table = {
  product(a, b, c, v, n) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        c[i][j] = 0;
        for (let k = 0; k < n; k++) c[i][j] += a[i][k] * b[k][j];
      }
  },
  column(a, b, c, v, n) {
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) c[1][j] += b[k][j] * 2;
  },
  rowTimesColumn(a, b, c, v, n) {
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) c[2][k] = a[2][k] - b[k][j] * v[k];
  },
  difference(a, b, c, v, n) {
    for (let k = 0; k < n; k++) c[0][k] -= b[k][k] * a[1][k];
  },
  lastOf(a, b, c, v, n) {
    for (let k = 0; k < n; k++) {
      const row = b[k];
      c[1][0] = row[row.length - 1] * 0.5 + c[1][0];
    }
  },
};
const N = 5;
const rows = make => Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => make(i, j)));
const real = (i, j) => Math.sin(i * 7 + j * 3 + 1), whole = (i, j) => i * 3 - j, boxed = (i, j) => (j === 4 ? null : i - j / 2);
const changes = {
  none() {},
  missingRow: (a, b) => { b[3] = undefined; },
  hole: (a, b) => { delete b[2][1]; },
  holeInStored: (a, b, c) => { delete c[1][2]; },
  short: (a, b) => { b[4].length = 2; },
  shortStored: (a, b, c) => { c[2].length = 1; },
  sharedRow: (a, b, c) => { c[1] = b[2]; },
  sharedHolder: (a, b, c) => { for (let i = 0; i < N; i++) c[i] = b[i]; },
  ownHolder: (a, b, c) => { c[1] = c; },
  holderOfOther: (a, b, c) => { c[1] = b; },
  nan: (a, b) => { b[2][2] = NaN; },
  negativeZero: (a, b) => { b[2].fill(-0); },
  text: (a, b) => { b[1][3] = "7"; },
  textRow: (a, b) => { b[1] = "12345"; },
  view: (a, b) => { b[3] = new Float64Array([1, 2, 3, 4, 5]); },
  frozen: (a, b, c) => { Object.freeze(c[1]); },
  getter: (a, b, c) => { let n = 0; Object.defineProperty(b, 2, { get() { c[1] = [n++, 2, 3, 4, 5]; return a[2]; } }); },
  getterInRow: (a, b, c) => { let n = 0; Object.defineProperty(b[2], 1, { get() { c[0] = [n++, 2, 3, 4, 5]; return 3; } }); },
  object: (a, b) => { b[2] = { 0: 1, 1: 2, 2: 3, length: 3 }; },
  big: (a, b) => { b[2][2] = 5n; },
};
globalThis["rows" + process.pid] = [table, changes];
for (const name of Object.keys(table)) {
  const line = [];
  for (const change of Object.keys(changes)) {
    let hash = 0;
    for (const [x, y, z] of [[real, real, real], [whole, whole, whole], [real, whole, boxed], [boxed, real, real], [real, boxed, whole]]) {
      const a = rows(x), b = rows(y), c = rows(z), v = rows(x)[1];
      changes[change](a, b, c);
      let text = "";
      for (let turn = 0; turn < 3; turn++) {
        try {
          table[name](a, b, c, v, N);
        } catch (error) {
          text += error.name;
        }
        text += change === "ownHolder" || change === "holderOfOther" ? show(c[0]) + show(c[2]) + show(b[0]) + c.length : show(a) + show(b) + show(c);
      }
      for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0;
    }
    line.push(change + " " + hash);
  }
  console.log(name, line.join(" | "));
}
