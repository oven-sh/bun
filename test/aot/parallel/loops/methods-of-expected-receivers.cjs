// A loop that calls a method of a receiver that is only expected to be of a class asks for the class and the method before it and copies the method.
// STATISTIC: ExpectedMethodsInLoops >= 1
const log = [];
class Matrix {
  constructor(rows, columns, f) {
    this.data = new Array(rows);
    for (let i = 0; i < rows; i++) {
      this.data[i] = new Array(columns);
      for (let j = 0; j < columns; j++) this.data[i][j] = f(i, j);
    }
    this.rows = rows;
    this.columns = columns;
  }
  get(i, j) { return this.data[i][j]; }
  set(i, j, value) { this.data[i][j] = value; return this; }
  times(other, out) {
    const column = new Array(this.columns);
    for (let j = 0; j < other.columns; j++) {
      for (let k = 0; k < this.columns; k++) column[k] = other.get(k, j);
      for (let i = 0; i < this.rows; i++) {
        let s = 0;
        for (let k = 0; k < this.columns; k++) s += this.get(i, k) * column[k];
        out.set(i, j, s);
      }
    }
    return out;
  }
  sum() {
    let s = 0;
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) s += this.get(i, j);
    return s;
  }
  largest() {
    let v = this.get(0, 0);
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) if (this.get(i, j) > v) v = this.get(i, j);
    return v;
  }
}
class Doubled extends Matrix { get(i, j) { return super.get(i, j) * 2; } }
globalThis["matrix" + process.pid] = [Matrix, Doubled];
function text(v) { return typeof v === "number" && Object.is(v, -0) ? "-0" : String(v); }
function dump(m) { return m.data.map((row) => (Array.isArray(row) ? row.map(text).join() : typeof row)).join(";"); }
function attempt(f) {
  try {
    const v = f();
    return v instanceof Matrix ? dump(v) : text(v);
  } catch (error) {
    return error.constructor.name;
  }
}
const fills = { halves: (i, j) => i * 3 + j + 0.5, whole: (i, j) => i - j, mixed: (i, j) => (j ? i : i + 0.25), texts: (i, j) => "t" + i, odd: (i, j) => [NaN, -0, 2 ** 31, undefined, 2 ** 53][(i + j) % 5] };
const changes = {
  nothing() {},
  own(m) { m.get = (i, j) => i * 10 + j; },
  other(m) { Object.setPrototypeOf(m, { get: (i, j) => 7 - i, set() { return this; }, times: Matrix.prototype.times, sum: Matrix.prototype.sum, largest: Matrix.prototype.largest }); },
  row(m) { m.data[1] = m.data[0]; },
  hole(m) { delete m.data[0][1]; },
  noRow(m) { m.data[1] = undefined; },
  view(m) { m.data[1] = new Float64Array([1.5, 2, 3]); },
  noData(m) { m.data = null; },
  bound(m) { m.columns = { valueOf() { log.push("columns"); return 2; } }; },
  counted(m) { let n = 0; Object.defineProperty(m, "columns", { get() { log.push("read"); return n++ < 5 ? 3 : 2; } }); },
  later(m) { m.rows = 2; let n = 0; const data = m.data; Object.defineProperty(m, "data", { get() { if (++n === 4) throw new RangeError(); return data; }, configurable: true }); },
  proxied(m) { m.data = new Proxy(m.data, { get(t, k, r) { if (k === "1") log.push("trap"); return Reflect.get(t, k, r); } }); },
};
function all(label) {
  for (const C of [Matrix, Doubled]) {
    for (const fill of Object.keys(fills)) {
      for (const change of Object.keys(changes)) {
        const m = new C(3, 3, fills[fill]), beside = new Matrix(3, 3, (i, j) => i / 2 + j);
        const results = [attempt(() => m.times(beside, new Matrix(3, 3, () => 0))), attempt(() => m.sum())];
        results.push(attempt(() => changes[change](m)));
        results.push(attempt(() => m.times(beside, new Matrix(3, 3, () => 0))), attempt(() => beside.times(m, new C(3, 3, () => 0.5))), attempt(() => m.times(m, m)), attempt(() => m.sum()), attempt(() => m.largest()));
        console.log(label, C.name, fill, change, results.join(" | "), log.length, [...new Set(log)].join());
        log.length = 0;
      }
    }
  }
}
all("first");
const get = Matrix.prototype.get;
let calls = 0;
Matrix.prototype.get = function (i, j) { if (++calls % 5 === 0) Matrix.prototype.get = get; return get.call(this, i, j) + 1; };
all("replaced");
Object.defineProperty(Matrix.prototype, "get", { get() { log.push("looked up"); return get; }, configurable: true });
all("accessor");
