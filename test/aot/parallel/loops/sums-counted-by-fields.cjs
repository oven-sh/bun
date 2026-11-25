// STATISTIC: RowSumLoops >= 1
// The inner loop of a sum over rows counts to a field that holds any integer. Every bound, kind of row and shared row gives the answers of the written loop.
class Matrix {
  constructor(rows) {
    this.data = rows;
    this.m = rows.length;
    this.n = rows[0].length;
  }
  times(other) {
    const c = [];
    for (let i = 0; i < this.m; i++) {
      c[i] = new Array(other.n);
      for (let j = 0; j < other.n; j++) {
        let s = 0;
        for (let k = 0; k < this.n; k++) s += this.data[i][k] * other.data[k][j];
        c[i][j] = s;
      }
    }
    return new Matrix(c);
  }
  timesTransposed(other) {
    const c = [];
    for (let i = 0; i < this.m; i++) {
      c[i] = new Array(other.m);
      for (let j = 0; j < other.m; j++) {
        let s = 0.5;
        for (let k = 0; k < this.n; k++) s += this.data[i][k] * other.data[j][k];
        c[i][j] = s;
      }
    }
    return new Matrix(c);
  }
  plus(other) {
    for (let i = 0; i < this.m; i++) for (let j = 0; j < this.n; j++) this.data[i][j] += other.data[i][j];
    return this;
  }
}
const rows = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const real = (i, j) => Math.sin(i * 7 + j * 3 + 1), whole = (i, j) => i * 3 - j, third = (i, j) => (i === 1 && j === 2 ? NaN : i / 3 - j);
function show(matrix) {
  let text = "";
  for (const row of matrix.data) for (let j = 0; j < row.length; j++) text += (row[j] === 0 && 1 / row[j] < 0 ? "-0" : row[j]) + (j in row ? "," : "!");
  let hash = 0;
  for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0;
  return hash;
}
function run(work) {
  try {
    return show(work());
  } catch (error) {
    return error.name;
  }
}
for (const f of [real, whole, third]) {
  for (const [m, n, p] of [[1, 1, 1], [2, 3, 4], [4, 4, 4], [7, 5, 9], [12, 20, 8], [3, 33, 40]]) {
    const line = [];
    for (const more of [0, -1, -n, 1, 5]) {
      const x = new Matrix(rows(m, n, f)), y = new Matrix(rows(n, p, real)), z = new Matrix(rows(p, n, f)), w = new Matrix(rows(m, n, real));
      for (const row of x.data) row.length = n + more;
      line.push(run(() => x.times(y)), run(() => x.times(y)), run(() => x.timesTransposed(z)), run(() => x.plus(w)));
      if (more < 0) y.data.length = n + more;
      line.push(run(() => w.times(y)), run(() => z.timesTransposed(x)));
    }
    console.log(m, n, p, f.name, line.join());
  }
}
const x = new Matrix(rows(6, 6, real));
x.data[2] = x.data[4];
delete x.data[3][1];
const y = new Matrix(x.data);
console.log(run(() => x.times(y)), run(() => x.timesTransposed(y)), run(() => x.plus(y)), run(() => x.times(y)));
x.data[5].length = 3;
console.log(run(() => x.times(y)), run(() => x.timesTransposed(y)), run(() => x.plus(y)));
