// fill(value): a method stores what its caller passes through set(i, j, value): numbers and what is none, into rows of int32s, of doubles, of anything, with holes.
// STATISTIC: CallerNumbersStoredByKind >= 1
const log = [];
class Matrix extends Array {
  constructor(rows, columns, row) {
    super(rows);
    for (let i = 0; i < rows; i++) this[i] = row(columns, i);
    this.rows = rows;
    this.columns = columns;
  }
  set(i, j, value) { this[i][j] = value; return this; }
  /** @param {number} value */
  fill(value) {
    for (var i = 0; i < this.rows; i++) {
      for (var j = 0; j < this.columns; j++) this.set(i, j, value);
    }
    return this;
  }
  /**
   * @param {number} i
   * @param {number} value
   */
  fillRow(i, value) {
    for (var j = 0; j < this.columns; j++) this.set(i, j, value);
    return this;
  }
  /** @param {number} value */
  scaled(value) {
    const twice = value * 2;
    for (var i = 0; i < this.rows; i++) {
      for (var j = 0; j < this.columns; j++) this.set(i, j, twice);
    }
    return this;
  }
}
globalThis.held = Matrix;
const word = value => typeof value === "number" ? Object.is(value, -0) ? "-0" : String(value) : value === undefined ? "undefined" : typeof value === "object" && value !== null ? "object" : String(value);
function dump(a) {
  return a.map(row => row && row.length !== undefined ? row.length + ":" + Array.from({ length: row.length }, (x, j) => j in row ? word(row[j]) : "hole").join(" ") : word(row)).join(" / ");
}
Object.defineProperty(Matrix, Symbol.species, { get: () => Array });
function attempt(name, f) {
  try { console.log(name, f()); } catch (error) { console.log(name, error.constructor.name, error.message.slice(0, 12)); }
}
const rows = {
  empty: columns => new Array(columns),
  whole: columns => Array.from({ length: columns }, (x, j) => j),
  doubles: columns => Array.from({ length: columns }, (x, j) => j + 0.5),
  words: columns => Array.from({ length: columns }, (x, j) => "w" + j),
  either: (columns, i) => Array.from({ length: columns }, (x, j) => i & 1 ? j : j + 0.5),
  frozen: (columns, i) => i === 1 ? Object.freeze([1, 2, 3]) : [1, 2, 3],
  short: (columns, i) => i === 1 ? [1] : [0.5, 1, 2],
  none: (columns, i) => i === 1 ? undefined : [1, 2, 3],
};
const values = [0, 1, 2.5, -0, NaN, 2147483648, "x", "7", undefined, null, true, { valueOf() { log.push("value"); return 4; } }, 1e300];
for (let turn = 0; turn < 3; turn++) {
  for (const name of Object.keys(rows)) {
    for (const value of values) {
      const a = new Matrix(3, 3, rows[name]);
      attempt(name, () => dump(a.fill(value)));
      attempt("row", () => dump(a.fillRow(turn, value)));
      attempt("twice", () => dump(a.scaled(value)));
      attempt("then", () => dump(a.fill(1)));
    }
  }
}
console.log(log.length);
