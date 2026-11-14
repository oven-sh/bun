// Loops of a mixin's methods over arrays of rows, over views of them and over other receivers. Receivers, rows, bounds, fields and methods change between and within the loops.
const log = [];
const keys = new Map("get set matrix rows columns".split(" ").map(key => [key, key]));
const word = x => Object.is(x, -0) ? "-0" : typeof x === "object" && x !== null ? "object" : String(x);
function say(...words) { log.push(words.map(word).join(" ")); }
function lay(holder, key, value) { Reflect.defineProperty(holder, keys.get(key), { value, writable: true, configurable: true }); }
function getter(holder, key, get) { Reflect.defineProperty(holder, keys.get(key), { get, configurable: true }); }
function mixin(Base) {
  if (Base === undefined) Base = Object;
  return class Mixed extends Base {
    product(other, at) {
      const m = this.rows, n = this.columns, p = other.columns, column = new Array(n), all = [];
      for (let j = 0; j < p; j++) {
        for (let k = 0; k < n; k++) column[k] = other.get(k, j);
        for (let i = 0; i < m; i++) {
          if (at) at(this, i, j);
          let sum = 0;
          for (let k = 0; k < n; k++) sum += this.get(i, k) * column[k];
          all.push(sum);
        }
      }
      return all;
    }
    total(at) {
      let sum = 0;
      for (let i = 0; i < this.rows; i++) for (let k = 0; k < this.columns; k++) { if (at) at(this, i, k); sum += this.get(i, k); }
      return sum;
    }
    scale(by) {
      for (let i = 0; i < this.rows; i++) for (let k = 0; k < this.columns; k++) this.set(i, k, this.get(i, k) * by);
      return this;
    }
    differs(other) {
      let sum = 0;
      for (let k = 0; k < this.columns; k++) sum += this.get(0, k) - other.get(0, k);
      return sum;
    }
  };
}
const mixed = mixin;
class View extends mixed() { constructor(matrix, rows, columns) { super(); this.matrix = matrix; this.rows = rows; this.columns = columns; } }
class Transpose extends View {
  constructor(matrix) { super(matrix, matrix.columns, matrix.rows); }
  set(i, j, value) { this.matrix.set(j, i, value); return this; }
  get(i, j) { return this.matrix.get(j, i); }
}
class Matrix extends mixed(Array) {
  constructor(rows, columns, value) {
    super(rows);
    for (let i = 0; i < rows; i++) { this[i] = new Array(columns); for (let j = 0; j < columns; j++) this[i][j] = value(i, j); }
    this.rows = rows;
    this.columns = columns;
  }
  set(i, j, value) { this[i][j] = value; return this; }
  get(i, j) { return this[i][j]; }
}
const values = [(i, j) => i + j, (i, j) => i / 2 + j, (i, j) => (i + j) & 1 ? i : 0.5, (i, j) => j ? i : undefined, (i, j) => 2147483647 - i + j, () => -0, (i, j) => i === j ? NaN : j];
const other = { rows: 2, columns: 2, get(i, j) { return i - j; }, set() { return this; } };
function round(title) {
  for (let k = 0; k < values.length; k++) {
    const a = new Matrix(3, 4, values[k]), b = new Matrix(4, 3, values[(k + 1) % values.length]), view = new Transpose(a), twice = new Transpose(view);
    for (const receiver of [a, view, twice, b, new Transpose(b)]) {
      for (const argument of [b, view, a, new Transpose(b)]) {
        let answer;
        try { answer = receiver.columns === argument.rows ? receiver.product(argument).map(word).join() : receiver.differs(argument); } catch (error) { answer = error.name; }
        say(title, k, answer);
      }
      try { say(title, k, receiver.total(), receiver.scale(0.5).total()); } catch (error) { say(title, k, error.name); }
    }
    try { say(title, a.product.call(other, other).map(word).join(), a.total.call(other)); } catch (error) { say(title, error.name); }
  }
}
function within(title, change) {
  for (const at of [0, 1, 4]) {
    const a = new Matrix(3, 3, (i, j) => i * 0.5 + j), b = new Matrix(3, 3, (i, j) => i - j), view = new Transpose(a);
    for (const receiver of [view, a]) {
      let count = 0;
      try { say(title, at, receiver.product(b, () => { if (count++ === at) change(a, b, view); }).map(word).join()); } catch (error) { say(title, at, error.name); }
      try { say(title, at, receiver.total((o, i, k) => { if (count++ === 6 + at) change(b, a, view); })); } catch (error) { say(title, at, error.name); }
    }
  }
}
round("first");
round("again");
within("a row of other values", a => { a[1] = ["x", {}, 2]; });
within("a row of int32s", a => { a[1] = [1, 2, 3]; });
within("a short row", a => { a[2].length = 1; });
within("a hole", a => { delete a[1][1]; });
within("a typed row", a => { a[0] = new Float64Array([4, 5, 6]); });
within("no row", a => { a.length = 2; });
within("frozen", a => { Object.freeze(a[0]); Object.freeze(a); });
within("another matrix", (a, b, view) => { view.matrix = b; });
within("a view of a view", (a, b, view) => { view.matrix = new Transpose(b); });
within("another kind of matrix", (a, b, view) => { view.matrix = other; });
within("a getter of the matrix", (a, b, view) => { getter(view, "matrix", () => b); });
within("an own method", (a, b, view) => { lay(view, "get", (i, j) => i * 10 + j); lay(a, "get", (i, j) => j - i); });
within("columns", (a, b, view) => { view.columns = 2; a.columns = 2.5; });
within("another prototype", (a, b, view) => { Reflect.setPrototypeOf(view, Matrix.prototype); Reflect.setPrototypeOf(a, Transpose.prototype); });
round("before");
lay(Transpose.prototype, "get", function (i, j) { return this.matrix.get(j, i) + 1; });
round("another get of views");
lay(Matrix.prototype, "get", function (i, j) { return this[i][j] * 2; });
round("another get of matrices");
console.log(log.join("\n"));
