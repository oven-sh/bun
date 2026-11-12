// Arrays of rows that a loop indexes by its counter: the checks of the rows count those that pass, and no row is checked again as long as nothing may have changed one. Rows, kinds, lengths and the array itself change between and within the loops.
// STATISTIC: RowsCountedByChecks >= 1
// STATISTIC: UnrolledLoopsOverCountedRows >= 1
// STATISTIC: KnownKindsCheckedAtLoopEntry >= 1
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
  mmul(other, between) {
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
      if (j === 1) between(this, result);
    }
    return result;
  }
  columnSums(out, between) {
    var m = this.rows;
    var p = this.columns;
    for (var j = 0; j < p; j++) {
      var s = 0;
      for (var i = 0; i < m; i++) s += this.get(i, j) * 2;
      out[j] = s;
      if (j === 1) between(this, this);
    }
    return out;
  }
  columnSumsAlone(out) {
    var m = this.rows;
    var p = this.columns;
    for (var j = 0; j < p; j++) {
      var s = 0;
      for (var i = 0; i < m; i++) s += this.get(i, j) * 2;
      out[j] = s;
    }
    return out;
  }
}
globalThis.Matrix = Matrix;
const plain = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : Array.isArray(v) ? "[" + Array.from(v, plain).join(" ") + "]" : typeof v === "object" && v !== null ? "object" : String(v);
const changes = {
  nothing() {},
  otherRow(a) { a[1] = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]; },
  text(a) { a[1] = "0123456789"; },
  none(a) { a[2] = undefined; },
  view(a) { a[1] = new Float64Array(20).fill(1.5); },
  shortRow(a) { a[1].length = 1; },
  longRow(a) { a[1].push(1.5); },
  hole(a) { delete a[1][1]; },
  stringInRow(a) { a[1][1] = "7"; },
  object(a) { a[1][1] = { valueOf() { log.push("valueOf"); return 3; } }; },
  frozenRow(a, b) { Object.freeze(b[1]); },
  named(a) { a[1].name = "row"; },
  noPrototype(a) { Object.setPrototypeOf(a[1], null); },
  getter(a) { Object.defineProperty(a[1], 1, { get() { log.push("get"); return 4; }, configurable: true }); },
  rowGetter(a) { Object.defineProperty(a, 1, { get() { log.push("row"); return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; }, configurable: true }); },
  fewer(a) { a.length = 2; },
  swapped(a) { [a[0], a[1]] = [a[1], a[0]]; },
  reversed(a) { a.reverse(); },
  same(a) { a[0] = a[2]; },
  itself(a) { a[0] = a; },
  sparse(a) { a[1][100000] = 1; },
  proxy(a) { a[1] = new Proxy(a[1], { get(target, key) { log.push(String(key)); return target[key]; } }); },
  stops() { throw new Error("stops"); },
};
const show = (name, f) => { try { console.log(name, plain(f())); } catch (error) { console.log(name, error.constructor.name); } };
for (const size of [3, 9, 20]) {
  for (const name in changes) {
    const fill = (i, j) => i * 4 + j + 0.5;
    const a = new Matrix(size, size, fill);
    const b = new Matrix(size, 3, (i, j) => i - j * 0.25);
    show(name, () => a.mmul(b, changes[name]));
    show(name, () => a.columnSums(new Array(size).fill(0.5), changes[name]));
    show(name, () => a.columnSumsAlone(new Array(size).fill(0.5)));
  }
}
for (const rows of [2, 9, 17]) {
  const a = new Matrix(rows, 5, (i, j) => i % 2 ? i + j : i + j + 0.5);
  show("kinds " + rows, () => a.columnSumsAlone(new Array(5).fill(0.5)));
  a.rows = rows + 1;
  show("more " + rows, () => a.columnSumsAlone(new Array(5).fill(0.5)));
  a.rows = 1.5;
  show("part " + rows, () => a.columnSumsAlone(new Array(5).fill(0.5)));
}
console.log(log.length, log.slice(0, 20).join(" "));
// The array of rows is made here and leaves the function nowhere.
function fillsAndReads(n, m, changed, value) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array(m);
    for (let j = 0; j < m; j++) row[j] = i * 2 + j + 0.5;
    rows[i] = row;
  }
  let total = 0;
  for (let j = 0; j < m; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rows[i][j];
    total += sum;
    if (j === 1) rows[changed] = value;
  }
  return total;
}
function replacesRows(given, n, m, other) {
  const rows = [given[0], given[1], given[2], given[3]];
  let total = 0;
  for (let j = 0; j < m; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rows[i][j];
    total += sum;
    if (j === 1) for (let i = 0; i < 2; i++) rows[i] = other;
  }
  return total;
}
globalThis.fillsAndReads = fillsAndReads;
globalThis.replacesRows = replacesRows;
for (const value of [undefined, 5, "text", [], [1], null, [0.5, 0.5, 0.5, 0.5, 0.5]]) {
  show("made here", () => fillsAndReads(4, 5, 7, value));
  show("changed here", () => fillsAndReads(4, 5, 1, value));
  show("replaced", () => replacesRows([[0.5, 1.5, 2.5], [1, 2, 3.5], [0.5, 1, 2], [4.5, 5, 6]], 4, 3, value));
}
// Rows of doubles, of integers, of both.
function product(a, b, out, n) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += a[i][k] * b[k][j];
      out[i][j] = sum;
    }
  }
  return out;
}
globalThis.product = product;
const square = (n, f) => Array.from({ length: n }, (v, i) => Array.from({ length: n }, (w, j) => f(i, j)));
for (const n of [2, 9, 12]) {
  for (const f of [(i, j) => i + j, (i, j) => i + j + 0.5, (i, j) => i % 2 ? i + j : j + 0.25, (i, j) => i === 1 && j === 1 ? NaN : i, (i, j) => i === 2 ? undefined : j + 0.5]) {
    show("product " + n, () => product(square(n, f), square(n, f), square(n, () => 0.5), n));
    const same = square(n, f);
    show("itself " + n, () => product(same, same, same, n));
  }
}
