// Products of matrices: the loop over columns gathers a column and sums over all rows. Results that share rows with the operands, short rows, NaN and odd rows give the answers of the written loops.
let asked = 0;
let prepared = null;
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, show).join() + ":" + value.length + "]" : value instanceof Float64Array ? "F" + [...value].map(show) : String(value);
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
      this.columns = given[0].length;
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
const rows = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const kinds = [
  (i, j) => i * 0.5 - j + 0.25,
  (i, j) => i + j - 3,
  (i, j) => (i % 2 ? j : j + 0.5),
  (i, j) => (i === 2 && j === 1 ? NaN : i - j * 0.5),
  (i, j) => (i ? 1e308 * (j + 0.5) : -0),
];
const results = [
  () => null,
  (a, b, m, p) => new Matrix(rows(m, p, () => 0.5)),
  a => new Matrix([...a]),
  (a, b, m, p) => new Matrix(rows(m, p, () => 0.5).map((row, i) => (i % 2 ? row : a[i] ?? row))),
  (a, b, m, p) => new Matrix(rows(m, p, () => 0.5).map((row, i) => (i === 1 ? b[0] : row))),
  (a, b, m, p) => new Matrix(rows(m, p, () => 0.5).map((row, i) => (i === m - 1 ? [0.5] : row))),
  (a, b, m, p) => new Matrix(rows(m, p, () => 0.5).map((row, i) => (i === m >> 1 ? Object.freeze(row) : row))),
  (a, b, m, p) => new Matrix(rows(m, p, () => 0.5).map((row, i, all) => all[i >> 1])),
  (a, b, m, p, o) => new Matrix(rows(m, p, () => 0.5).map((row, i) => (i === 1 ? o[0] : i === 0 ? o[p - 1] : row))),
  (a, b, m, p) => new Matrix(rows(m, p, () => 3)),
  (a, b, m, p) => new Matrix(rows(m, p, () => 0.5).map((row, i) => (i === 1 ? Object.defineProperty(row, 0, { get: () => asked++, set: () => (asked += 2) }) : row))),
];
for (const left of kinds) {
  for (const right of kinds.slice(0, 2)) {
    for (const [m, n, p] of [[2, 2, 2], [4, 2, 4], [9, 3, 2], [3, 5, 9]]) {
      for (const result of results) {
        for (const form of [(a, b) => a.mmul(b), (a, b, t) => t.transposed().mmul(b), (a, b, t, o) => a.mmul(o.transposed()), (a, b, t, o) => t.transposed().mmul(o.transposed())]) {
          const a = new Matrix(rows(m, n, left));
          const b = new Matrix(rows(n, p, right));
          const t = new Matrix(rows(n, m, left));
          const o = new Matrix(rows(p, n, right));
          prepared = result(form.length > 2 && form(a, b, t, o) ? t : a, b, m, p, o);
          let text;
          try {
            text = show([...form(a, b, t, o)]);
          } catch (error) {
            text = error.name;
          }
          prepared = null;
          if (m < 5 || text.length < 120) console.log(m, n, p, text, asked);
          else console.log(m, n, p, text.length, text.slice(-60), asked);
          if (m === 2) console.log(show([...a]), show([...b]), show([...t]), show([...o]));
        }
      }
    }
  }
}
