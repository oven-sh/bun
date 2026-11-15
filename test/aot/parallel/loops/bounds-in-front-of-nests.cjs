// Inner reader loops whose bound and whose list's storage are asked for in front of the loop around: bounds that are no int32s, bounds and lists that change in the middle.
// STATISTIC: LoopsVersionedInsideOuterVersions >= 1
// STATISTIC: InnerBoundsHoistedToOuterLoops >= 1
// STATISTIC: RowStoragesFromOuterPreheaders >= 1
const log = [];
class Matrix extends Array {
  constructor(rows, columns, f) {
    super(rows);
    for (let i = 0; i < rows; i++) {
      this[i] = new Array(columns);
      for (let j = 0; j < columns; j++) this[i][j] = f(i, j);
    }
    this.rows = rows;
    this.columns = columns;
  }
  get(i, j) { return this[i][j]; }
  set(i, j, value) { this[i][j] = value; return this; }
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
  rowSums(out, n) {
    var m = this.rows;
    for (var i = 0; i < m; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      out[i] = s;
    }
    return out;
  }
  grows(out, n) {
    for (var i = 0; i < this.length; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      if (this.length < 6) this.push([s, s + 0.5, i]);
      out[i] = s;
    }
    return out;
  }
  changesBound(out) {
    var n = this.columns;
    for (var i = 0; i < this.rows; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      out[i] = s;
      if (i === 1) n = 1.5;
    }
    return out;
  }
  intoItself(rows) {
    var n = this.columns;
    for (var i = 0; i < this.rows; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      this[i] = rows[i % rows.length];
      log.push(s);
    }
    return this.rows;
  }
}
globalThis.held = Matrix;
const plain = value => typeof value === "number" ? Object.is(value, -0) ? "-0" : String(value) : Array.isArray(value) ? "[" + Array.from(value, plain).join(" ") + "]" : String(value);
function attempt(name, f) {
  try { console.log(name, plain(f())); } catch (error) { console.log(name, error.constructor.name, error.message.slice(0, 12)); }
}
const bounds = { "3": 3, "2.5": 2.5, "-0": -0, "-1": -1, NaN: NaN, "two": "2", undefined: undefined, null: null, object: { valueOf() { log.push("bound"); return 2; } }, "4": 4, "true": true, "3n": 3n };
for (let turn = 0; turn < 3; turn++) {
  for (const name of Object.keys(bounds)) {
    const a = new Matrix(4, 3, (i, j) => i * 3 + j + (turn ? 0.5 : 0)), b = new Matrix(3, 5, (i, j) => i - j + 0.25);
    attempt("product " + name, () => a.mmul(b));
    attempt("sums " + name, () => a.rowSums([0.5, 0.5, 0.5, 0.5], bounds[name]));
    attempt("grows " + name, () => new Matrix(2, 3, (i, j) => i + j).grows([], bounds[name]));
    a.columns = bounds[name];
    attempt("columns " + name, () => a.mmul(b));
    attempt("bound " + name, () => a.changesBound([]));
    a.columns = 3;
    attempt("itself " + name, () => a.intoItself([[1, 2, 3], ["x", 1.5], Object.freeze([4, 5, 6]), undefined]));
    attempt("behind " + name, () => a.rowSums([], 2));
  }
}
console.log(log.length, log.map(plain).join(" ").slice(0, 400));
