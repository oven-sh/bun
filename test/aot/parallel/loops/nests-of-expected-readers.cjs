// Inner loops that call a method of an expected receiver, versioned inside the version of the loop around: where a guard fails, the iteration around begins again.
// STATISTIC: LoopsVersionedInsideOuterVersions >= 1
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
    var m = this.rows, n = this.columns, p = other.columns;
    var result = new Matrix(m, p, () => 0);
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
  rowSumsBehindStores(out) {
    var m = this.rows, n = this.columns;
    for (var i = 0; i < m; i++) {
      out[i] = -1;
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * out[i];
      out[i] = s;
    }
    return out;
  }
  rowSumsBehindCalls(out) {
    var m = this.rows, n = this.columns;
    for (var i = 0; i < m; i++) {
      log.push(i);
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      out[i] = s;
      log.push(s);
    }
    return out;
  }
  firstBeyond(limit) {
    var m = this.rows, n = this.columns, found = [];
    for (var i = 0; i < m; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) {
        if (s > limit) break;
        s += this.get(i, k) * 2;
      }
      found.push(s);
    }
    return found;
  }
  intoItself(out) {
    var m = this.rows, n = this.columns;
    for (var i = 0; i < m; i++) {
      var s = 0;
      for (var k = 0; k < n; k++) s += this.get(i, k) * 2;
      this.set(i, 0, s);
      out[i] = s;
    }
    return out;
  }
}
globalThis.kept = [Matrix, Matrix.prototype];
const show = value => (typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : Array.isArray(value) ? "[" + Array.from(value, show).join(" ") + "]" : String(value));
function attempt(name, f) {
  try {
    console.log(name, show(f()), log.join(","));
  } catch (error) {
    console.log(name, error.constructor.name, log.join(","));
  }
  log.length = 0;
}
const fills = [(i, j) => i * 4 + j + 0.5, (i, j) => i + j, (i, j) => (i === 2 ? "t" + j : j), (i, j) => (i + j) % 3 ? undefined : 1.5, (i, j) => (j ? NaN : -0), (i, j) => [2147483647, 2147483648, 9007199254740993, -1][(i + j) % 4]];
const oddities = {
  none() {},
  hole(a) { delete a[1][1]; },
  shortRow(a) { a[2].length = 1; },
  otherKind(a) { a[1] = ["a", "b", "c", "d"]; },
  frozen(a) { a[1] = Object.freeze([1, 2, 3, 4]); },
  accessor(a) { Object.defineProperty(a[2], 1, { get() { log.push("read"); a[3] = [9, 9, 9, 9]; return 4; } }); },
  throws(a) { Object.defineProperty(a[2], 1, { get() { log.push("thrown"); throw new RangeError("in the middle"); } }); },
  converted(a) { a[2][0] = { valueOf() { log.push("converted"); return 3; } }; },
  bigint(a) { a[3][0] = 10n; },
  missingRow(a) { a[2] = undefined; },
  ownGet(a) { a.get = (i, j) => { log.push("own"); return i - j; }; },
  otherGet() { Matrix.prototype.get = function (i, j) { return this[i][j] * 1; }; },
  fractionalBound(a) { a.columns = 2.5; },
  textBound(a) { a.rows = "3"; },
  objectBound(a) { a.columns = { valueOf() { log.push("bound"); return 2; } }; },
  sharedRows(a) { a[1] = a[0]; },
};
for (const name of Object.keys(oddities)) {
  for (const fill of fills) {
    const a = new Matrix(4, 4, fill), b = new Matrix(4, 4, (i, j) => i - j + 0.25);
    attempt("plain", () => a.mmul(b));
    oddities[name](a);
    attempt(name, () => a.mmul(b));
    attempt("itself by itself", () => a.mmul(a));
    attempt("sums", () => a.rowSums([0, 0, 0, 0]));
    attempt("stores", () => a.rowSumsBehindStores([0.5, 0.5, 0.5, 0.5]));
    attempt("calls", () => a.rowSumsBehindCalls([]));
    attempt("limit", () => a.firstBeyond(10));
    attempt("over a row", () => a.rowSums(a[3]));
    attempt("itself", () => a.intoItself([0, 0, 0, 0]));
    attempt("after", () => a.rowSums([]));
  }
}
