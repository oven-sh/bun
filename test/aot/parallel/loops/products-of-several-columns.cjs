// Products of matrices whose sums of several columns are computed together: every number of terms and columns, rows of ints and of both kinds, NaN, infinities, short rows, results that share rows with themselves and with the
// operands. What is gathered last is read behind the loops.
let prepared = null;
let gathered = null;
const show = value => (value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, show).join() + ":" + value.length + "]" : String(value));
function mixin(Base) {
  if (Base === undefined) Base = Object;
  class Rows extends Base {
    static get [Symbol.species]() {
      if (!prepared) return this;
      const result = prepared;
      prepared = null;
      return function () {
        return result;
      };
    }
    mmul(other) {
      var m = this.rows;
      var n = this.columns;
      var p = other.columns;
      var result = new this.constructor[Symbol.species](m, p);
      var column = new Array(n);
      for (var j = 0; j < p; j++) {
        for (var k = 0; k < n; k++) column[k] = other.get(k, j);
        for (var i = 0; i < m; i++) {
          var s = 0;
          for (k = 0; k < n; k++) s += this.get(i, k) * column[k];
          result.set(i, j, s);
        }
      }
      gathered = column[0] + column[n >> 1] * 3;
      return result;
    }
    transposed() {
      return new View(this);
    }
  }
  return Rows;
}
const mixed = mixin;
class Matrix extends mixed(Array) {
  constructor(m, n) {
    if (Array.isArray(m)) {
      const given = m;
      super(given.length);
      for (let i = 0; i < given.length; i++) this[i] = given[i];
      this.rows = given.length;
      this.columns = given.length ? given[0].length : 0;
      return;
    }
    super(m);
    for (let i = 0; i < m; i++) this[i] = new Array(n);
    this.rows = m;
    this.columns = n;
  }
  set(i, j, value) {
    this[i][j] = value;
    return this;
  }
  get(i, j) {
    return this[i][j];
  }
}
class View extends mixed() {
  constructor(matrix) {
    super();
    this.matrix = matrix;
    this.rows = matrix.columns;
    this.columns = matrix.rows;
  }
  static get [Symbol.species]() {
    if (!prepared) return Matrix;
    const result = prepared;
    prepared = null;
    return function () {
      return result;
    };
  }
  set(i, j, value) {
    this.matrix.set(j, i, value);
    return this;
  }
  get(i, j) {
    return this.matrix.get(j, i);
  }
}
const made = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const real = (i, j) => Math.sin(i * 7 + j * 3 + 1);
const whole = (i, j) => ((i * 5 + j * 3) % 7) - 3;
const either = (i, j) => (i % 2 ? real(i, j) : whole(i, j));
const operands = [
  x => x,
  x => ((x[x.length >> 1][x[0].length >> 1] = NaN), x),
  x => ((x[x.length - 1][0] = Infinity), x),
  x => ((x[0][x[0].length - 1] = -0), x),
  x => (delete x[x.length >> 1][x[0].length - 1], x),
  x => ((x[x.length - 1] = x[0]), x),
  x => ((x[x.length >> 1] = x[x.length >> 1].slice(0, x[0].length >> 1)), x),
];
const results = [
  () => null,
  (m, p) => new Matrix(made(m, p, real)),
  (m, p) => new Matrix(made(m, p, real).fill(made(1, p, whole)[0])),
  (m, p, x) => new Matrix(made(m, p, real).map((row, i) => (i % 2 ? row : (x[i] ?? row)))),
  (m, p, x, y) => new Matrix(made(m, p, real).map((row, i) => (i ? row : (y[0] ?? row)))),
  (m, p) => new Matrix(made(m, p, whole)),
  (m, p) => new Matrix(made(m, p, real).map((row, i) => (i === m - 1 ? row.slice(0, 1) : row))),
];
function work(x, y, f, make) {
  prepared = make(x.rows, y.columns, x.matrix || x, y.matrix || y);
  const result = f(x, y);
  prepared = null;
  return show([...result]) + show(gathered);
}
let text = "";
let count = 0;
for (const [m, n, p] of [[1, 1, 1], [2, 2, 3], [4, 2, 4], [4, 4, 2], [16, 2, 20], [3, 5, 7], [2, 16, 9], [5, 33, 6], [3, 64, 5], [4, 70, 17]]) {
  for (const kind of [real, whole, either]) {
    for (const change of operands) {
      for (const make of results) {
        if (count++ % 3 && change !== operands[0] && make !== results[0]) continue;
        const a = new Matrix(change(made(m, n, kind)));
        const b = new Matrix(change(made(n, p, real)));
        const t = new Matrix(change(made(n, m, kind)));
        const o = new Matrix(change(made(p, n, real)));
        text += work(a, b, (x, y) => x.mmul(y), make);
        text += work(t.transposed(), b, (x, y) => x.mmul(y), make);
        text += work(a, o.transposed(), (x, y) => x.mmul(y), make);
        text += work(t.transposed(), o.transposed(), (x, y) => x.mmul(y), make);
        text += show([...a]) + show([...b]) + show([...t]) + show([...o]);
      }
    }
  }
  let hash = 0;
  for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0;
  console.log(m, n, p, text.length, hash);
}
