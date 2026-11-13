// A nest whose first loop reads a matrix or a view: the loop has a version for the view in every copy, also where a version by a branch was built in vain.
// STATISTIC: LoopsVersionedForOtherClass >= 2
function mixin(Base) {
  if (Base === undefined) Base = Object;
  class Mixed extends Base {
    mmul(other) {
      var m = this.rows;
      var n = this.columns;
      var p = other.columns;
      var result = new Matrix(m, p);
      var column = new Array(n);
      for (var j = 0; j < p; j++) {
        for (var k = 0; k < n; k++) column[k] = other.get(k, j);
        for (var i = 0; i < m; i++) {
          var s = 0;
          for (k = 0; k < n; k++) s += this.get(i, k) * column[k];
          result.set(i, j, s);
        }
      }
      return result;
    }
    sum() {
      let s = 0;
      for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) s += this.get(i, j);
      return s;
    }
  }
  return Mixed;
}
const mixed = mixin;
class Matrix extends mixed(Array) {
  constructor(rows, columns) {
    super(rows);
    for (let i = 0; i < rows; i++) {
      this[i] = new Array(columns);
      for (let j = 0; j < columns; j++) this[i][j] = 0.5;
    }
    this.rows = rows;
    this.columns = columns;
  }
  get(i, j) { return this[i][j]; }
  set(i, j, value) { this[i][j] = value; return this; }
}
class View extends mixed() {
  constructor(matrix) {
    super();
    this.matrix = matrix;
    this.rows = matrix.columns;
    this.columns = matrix.rows;
  }
  get(i, j) { return this.matrix.get(j, i); }
  set(i, j, value) { this.matrix.set(j, i, value); return this; }
}
globalThis.Matrix = Matrix;
globalThis.View = View;
const plain = v => Object.is(v, -0) ? "-0" : String(v);
const filled = (rows, columns, f) => { const m = new Matrix(rows, columns); for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) m.set(i, j, f(i, j)); return m; };
const values = [(i, j) => i * 4 + j + 0.5, (i, j) => i - j, (i, j) => i ? NaN : j, (i, j) => j === 1 ? undefined : i, (i, j) => j ? -0 : i];
for (const f of values) {
  for (const g of values) {
    const a = filled(9, 2, f), b = filled(2, 5, g), c = filled(5, 2, g);
    console.log(plain(a.mmul(b).sum()), plain(a.mmul(new View(c)).sum()), plain(new View(b).mmul(new View(a)).sum()), plain(new View(b).mmul(b).sum()));
  }
}
const odd = filled(2, 5, values[0]);
odd[1] = "ab";
console.log(plain(filled(9, 2, values[0]).mmul(odd).sum()), plain(filled(9, 2, values[0]).mmul(new View(filled(5, 2, values[1]))).sum()));
const other = new View(filled(5, 2, values[0]));
other.get = (i, j) => i + j + 0.25;
console.log(plain(filled(9, 2, values[0]).mmul(other).sum()));
