// Sums of elements that a copied get and a list give, and a column of them, beside odd rows.
// STATISTIC: RowsCheckedInStoringIterations >= 2
// STATISTIC: ArraysGuardedInIterations >= 3
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
  static get [Symbol.species]() { return Array; }
  get(i, j) { return this[i][j]; }
  set(i, j, value) { this[i][j] = value; return this; }
  plus(other) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + this.get(j, i));
    return this;
  }
  plusRow(v) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + v[j]);
    return this;
  }
  rowPlus(v) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, v[j] + this.get(i, j));
    return this;
  }
  square(out) {
    const column = new Array(this.columns);
    for (let j = 0; j < this.columns; j++) {
      for (let k = 0; k < this.rows; k++) column[k] = this.get(k, j);
      for (let i = 0; i < this.rows; i++) {
        let s = 0;
        for (let k = 0; k < this.columns; k++) s += this.get(i, k) * column[k];
        out.set(i, j, s);
      }
    }
    return out;
  }
}
class Parent extends Array {
  constructor(rows, columns, f) {
    super(rows);
    for (let i = 0; i < rows; i++) {
      this[i] = new Array(columns);
      for (let j = 0; j < columns; j++) this[i][j] = f(i, j);
    }
    this.rows = rows;
    this.columns = columns;
  }
  static get [Symbol.species]() { return Array; }
  get(i, j) { return this[i][j]; }
  set(i, j, value) { this[i][j] = value; return this; }
  plus(other) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + this.get(j, i));
    return this;
  }
  plusRow(v) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + v[j]);
    return this;
  }
  rowPlus(v) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, v[j] + this.get(i, j));
    return this;
  }
  square(out) {
    const column = new Array(this.columns);
    for (let j = 0; j < this.columns; j++) {
      for (let k = 0; k < this.rows; k++) column[k] = this.get(k, j);
      for (let i = 0; i < this.rows; i++) {
        let s = 0;
        for (let k = 0; k < this.columns; k++) s += this.get(i, k) * column[k];
        out.set(i, j, s);
      }
    }
    return out;
  }
}
class Doubled extends Parent { get(i, j) { return super.get(i, j) * 2; } }
globalThis["matrix" + process.pid] = [Matrix, Parent, Doubled];
function text(v) { return typeof v === "number" && Object.is(v, -0) ? "-0" : String(v); }
function dump(m) { return Array.from({ length: m.length }, (_, i) => (Array.isArray(m[i]) ? m[i].map(text).join() : typeof m[i])).join(";"); }
function attempt(f) {
  try {
    const v = f();
    return Array.isArray(v) ? dump(v) : text(v);
  } catch (error) {
    return error.constructor.name;
  }
}
const fills = { halves: (i, j) => i * 3 + j + 0.5, whole: (i, j) => i - j, mixed: (i, j) => (j ? i : i + 0.25), texts: (i, j) => "t" + i, odd: (i, j) => [NaN, -0, 2 ** 31, undefined, 2 ** 53][(i + j) % 5] };
const changes = {
  nothing() {},
  own(m) { m.get = (i, j) => i * 10 + j; },
  other(m) { Object.setPrototypeOf(m, { get: (i, j) => 7 - i, set() { return this; }, plus: Matrix.prototype.plus, plusRow: Matrix.prototype.plusRow, rowPlus: Matrix.prototype.rowPlus, square: Matrix.prototype.square }); },
  plain(m) { Object.setPrototypeOf(m, Array.prototype); },
  row(m) { m[1] = m[0]; },
  hole(m) { delete m[0][1]; },
  noRow(m) { delete m[1]; },
  above(m) { delete m[1]; Matrix.prototype[1] = Parent.prototype[1] = [5, 6, 7]; },
  text(m) { m[1] = "abc"; },
  view(m) { m[1] = new Float64Array([1.5, 2, 3]); },
  accessor(m) { Object.defineProperty(m, 1, { get() { log.push("row"); return [1, 2, 3]; }, configurable: true }); },
  frozen(m) { Object.freeze(m); Object.freeze(m[0]); },
  bound(m) { m.columns = { valueOf() { log.push("columns"); return 2; } }; },
  counted(m) { let n = 0; Object.defineProperty(m, "columns", { get() { log.push("read"); return n++ < 5 ? 3 : 2; } }); },
  long(m) { m.rows = 4; },
  negative(m) { m.rows = 3; m[-1] = [8, 8, 8]; },
  proxied(m) { m[1] = new Proxy([4, 5, 6], { get(t, k, r) { log.push("trap"); return Reflect.get(t, k, r); } }); },
  itself(m) { m[1] = m; },
};
function all(label) {
  for (const C of [Matrix, Parent, Doubled]) {
    for (const fill of Object.keys(fills)) {
      for (const change of Object.keys(changes)) {
        const m = new C(3, 3, fills[fill]), row = [0.5, -0, 2 ** 31], out = () => new Matrix(3, 3, () => 0.5);
        const results = [attempt(() => m.square(out())), attempt(() => m.plus()), attempt(() => changes[change](m))];
        results.push(attempt(() => m.square(out())), attempt(() => m.plusRow(row)), attempt(() => m.rowPlus(m[0])), attempt(() => m.plus()), attempt(() => m.square(m)), dump(m));
        results.push(attempt(() => m.plusRow(["a", undefined])), attempt(() => m.rowPlus(["b", 1n])), attempt(() => m.plusRow({ 0: 1, 1: null })), attempt(() => m.square(out())), dump(m));
        delete Matrix.prototype[1]; delete Parent.prototype[1];
        console.log(label, C.name, fill, change, results.join(" | "), log.length, [...new Set(log)].join());
        log.length = 0;
      }
    }
  }
}
all("first");
const found = globalThis["matrix" + process.pid][0].prototype;
const { get, set } = found;
let calls = 0;
found.get = function (i, j) { if (++calls % 5 === 0) found.get = get; return get.call(this, i, j) + 1; };
all("replaced");
Object.defineProperty(found, "get", { get() { log.push("looked up"); return get; }, configurable: true });
all("accessor");
found.set = function (i, j, value) { log.push("stored"); if (i === 1 && j === 1) throw new TypeError(); return set.call(this, i, j, value); };
all("thrown");
