// Nests of a mixin's method over the class below it that extends Array and over the view beside it: the version for the view holds its inner loop as that of the list does.
// STATISTIC: NestedLoopsVersionedForOtherClass >= 1
const log = [];
function mixin(Base) {
  if (Base === undefined) Base = Object;
  return class Mixed extends Base {
  transposed() { return new Transpose(this); }
  mmul(other) {
    var m = this.rows;
    var n = this.columns;
    var p = other.columns;
    var result = new Matrix(m, p, () => 0.5);
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
  rowSums(out) {
    var m = this.rows, n = this.columns;
    for (var i = 0; i < m; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      out[i] = s;
    }
    return out;
  }
  logged(out) {
    var m = this.rows, n = this.columns;
    for (var i = 0; i < m; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      log.push(s);
      out[i] = s;
    }
    return out;
  }
  };
}
const mixed = mixin;
class View extends mixed() {
  constructor(matrix, rows, columns) {
    super();
    this.matrix = matrix;
    this.rows = rows;
    this.columns = columns;
  }
}
class Transpose extends View {
  constructor(matrix) { super(matrix, matrix.columns, matrix.rows); }
  set(i, j, value) { this.matrix.set(j, i, value); return this; }
  get(i, j) { return this.matrix.get(j, i); }
}
class Matrix extends mixed(Array) {
  constructor(rows, columns, f) {
    super(rows);
    for (let i = 0; i < rows; i++) {
      this[i] = new Array(columns);
      for (let j = 0; j < columns; j++) this[i][j] = f(i, j);
    }
    this.rows = rows;
    this.columns = columns;
  }
  set(i, j, value) { this[i][j] = value; return this; }
  get(i, j) { return this[i][j]; }
}
globalThis.held = [Matrix, Transpose];
const plain = value => typeof value === "number" ? Object.is(value, -0) ? "-0" : String(value) : Array.isArray(value) ? "[" + Array.from(value, plain).join(" ") + "]" : String(value);
function attempt(name, f) {
  try { console.log(name, plain(f())); } catch (error) { console.log(name, error.constructor.name, error.message.slice(0, 12)); }
}
const changes = {
  nothing() { },
  hole(view) { delete view.matrix[1][1]; },
  row(view) { view.matrix[2] = ["a", 1.5, 2]; },
  short(view) { view.matrix[1].length = 1; },
  frozen(view) { Object.freeze(view.matrix[0]); },
  under(view) { view.matrix = view.matrix.transposed(); },
  bound(view) { view.columns = 1.5; },
  frozenView(view) { Object.freeze(view); },
  list(view) { view.matrix.length = 1; },
  object(view) { view.rows = { valueOf() { log.push("rows"); return 2; } }; },
  own(view) { view.get = (i, j) => { log.push("own"); return i - j; }; },
  text(view) { view.columns = "2"; },
  unset(view) { view.matrix = undefined; },
};
for (let turn = 0; turn < 3; turn++) {
  for (const name of Object.keys(changes)) {
    const a = new Matrix(3, 4, (i, j) => i * 4 + j + (turn ? 0.5 : 0)), b = new Matrix(3, 5, (i, j) => i - j + 0.25), view = a.transposed();
    attempt("list " + name, () => a.rowSums([]));
    attempt("before " + name, () => view.mmul(b));
    changes[name](view);
    attempt("product " + name, () => view.mmul(b));
    attempt("sums " + name, () => view.rowSums([0.5, 0.5, 0.5, 0.5]));
    attempt("logged " + name, () => view.logged([]));
    attempt("other " + name, () => b.mmul(b.transposed()));
    attempt("itself " + name, () => view.rowSums(view.matrix && view.matrix[0] || []));
    attempt("behind " + name, () => a.rowSums([]));
  }
}
console.log(log.length, log.map(plain).join(" ").slice(0, 400));
