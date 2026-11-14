// A loop over rows whose inner loop adds up or stores their elements has a version that checks the arrays of a row at once. Every kind of row, holes, NaN, shared rows and changed rows give the answers of the written loop.
let asked = 0;
const show = value => value === undefined ? "u" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : String(value);

function mixin(Base) {
  if (Base === undefined) Base = Object;
  class Rows extends Base {
    static get [Symbol.species]() {
      return this;
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
    add(other) {
      for (var i = 0; i < this.rows; i++)
        for (var j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + other.get(i, j));
      return this;
    }
    scale(number) {
      for (var i = 0; i < this.rows; i++)
        for (var j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) * number);
      return this;
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
      for (let i = 0; i < given.length; i++) this[i] = [].concat(given[i]);
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
  clone() {
    var made = new this.constructor[Symbol.species](this.rows, this.columns);
    for (var row = 0; row < this.rows; row++)
      for (var column = 0; column < this.columns; column++) made.set(row, column, this.get(row, column));
    return made;
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
    return Matrix;
  }
  set(i, j, value) {
    this.matrix.set(j, i, value);
    return this;
  }
  get(i, j) {
    return this.matrix.get(j, i);
  }
}

const filled = (m, n, f) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => f(i, j)));
const kinds = [
  (i, j) => i + j - 3,
  (i, j) => i * 0.5 - j + 0.25,
  (i, j) => (i + j) % 3 === 1 ? i - j : i + j * 0.1,
  (i, j) => i % 2 ? j : j + 0.5,
  (i, j) => i === 2 && j === 1 ? NaN : i - j * 0.5,
  (i, j) => i === j ? -0 : i ? 1e308 * j : -Infinity,
];
for (const a of kinds) {
  for (const b of kinds) {
    for (const [m, n, p] of [[1, 1, 1], [2, 2, 2], [4, 2, 4], [16, 2, 5], [5, 4, 3], [9, 7, 2], [3, 20, 3], [20, 16, 2]]) {
      const x = new Matrix(filled(m, n, a));
      const y = new Matrix(filled(n, p, b));
      const t = new Matrix(filled(n, m, a));
      const o = new Matrix(filled(p, n, b));
      let sum = 0;
      for (const result of [x.mmul(y), t.transposed().mmul(y), x.mmul(o.transposed()), t.transposed().mmul(o.transposed())]) {
        for (const row of result) for (const value of row) sum = Object.is(value, -0) ? sum + 0.125 : value === value ? sum * 0.5 + Math.max(Math.min(value, 1e9), -1e9) : sum + 7;
      }
      const c = x.clone();
      const d = c.clone().add(x).scale(0.5).add(c);
      for (const row of d) for (const value of row) sum = value === value ? sum * 0.5 + Math.max(Math.min(value, 1e9), -1e9) : sum + 3;
      if (m * n <= 10) console.log(show([...x.mmul(y)]), show([...d]));
      console.log(m, n, p, sum);
    }
  }
}

// Rows that are shared, changed on the way, too short, of other classes or with holes.
/**
 * @param {number[][]} a
 * @param {number[]} b
 * @param {number[][]} r
 * @param {number} m
 * @param {number} n
 * @param {number} p
 */
function sums(a, b, r, m, n, p) {
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[i][k] * b[k];
      r[i][j] = s;
    }
  }
}
/**
 * @param {number[][]} a
 * @param {number[][]} r
 * @param {number} m
 * @param {number} n
 * @param {number} p
 */
function columnSums(a, r, m, n, p) {
  const weights = new Array(n);
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < n; k++) weights[k] = k + 0.5;
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[k][i] * weights[k];
      r[i][j] = s;
    }
  }
}
const forms = [
  () => [],
  (a, r) => (r[1] = a[1]),
  (a, r) => r.forEach((_, i) => (r[i] = a[i])),
  (a, r) => (a[2] = a[0]),
  (a, r) => (r[0] = r[3]),
  (a, r) => (a[3] = [1, 2, 3, 4, 5]),
  (a, r) => (a[1] = [0.5, , 2.5, 1, 1]),
  (a, r) => (r[2] = [1, 2, 3, 4, 5]),
  (a, r) => (r[2] = Object.freeze([1.5, 2, 3, 4, 5])),
  (a, r) => (a[4] = [1.5]),
  (a, r) => (r[4] = []),
  (a, r) => (a[2] = new Float64Array([1.5, 2, 3, 4, 5])),
  (a, r) => (r[3] = new Float64Array(5)),
  (a, r) => (a[1] = { 0: 1, 1: 2, length: 5 }),
  (a, r) => Object.defineProperty(a[3], 1, { get: () => asked++, set: () => asked++ }),
  (a, r) => Object.defineProperty(r[1], 1, { get: () => asked++, set: () => asked++, configurable: true }),
];
const works = [
  (a, b, r) => sums(a, b, r, 5, 5, 5),
  (a, b, r) => columnSums(a, r, 5, 5, 5),
  (a, b, r) => sums(a, r[0], r, 5, 4, 5),
  (a, b, r) => columnSums(r, r, 5, 5, 5),
  (a, b, r) => sums(a, b, r, 6, 5, 2),
  (a, b, r) => columnSums(a, r, 5, 6, 2),
];
for (const form of forms) {
  for (const kind of kinds) {
    for (const work of works) {
      const a = filled(5, 5, kind);
      const r = filled(5, 5, () => 0.5);
      const b = [1.5, -2, 0.25, 3, 1];
      form(a, r);
      try {
        work(a, b, r);
      } catch (error) {
        console.log(error.name);
      }
      console.log(show(Array.from(r, row => Array.from(row))), asked);
    }
  }
}
