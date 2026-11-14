// set(i, j, value) { this[i][j] = value; } of a class that extends Array, called in loops beside get, by receivers that are only expected to be of the class.
// STATISTIC: RowHoldersOfSubclasses >= 5
// STATISTIC: ExpectedMethodsInLoops >= 20
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
  scale(x) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) * x);
    return this;
  }
  plusRow(v) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + v[j]);
    return this;
  }
  fill2(x) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, x);
    return this;
  }
  sum() {
    let s = 0;
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) s += this.get(i, j);
    return s;
  }
  upTo(limit) {
    let s = 0;
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.columns; j++) {
        s += this.get(i, j);
        if (s > limit) return s;
        this.set(i, j, s);
      }
    }
    return s;
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
  scale(x) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) * x);
    return this;
  }
  plusRow(v) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, this.get(i, j) + v[j]);
    return this;
  }
  fill2(x) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) this.set(i, j, x);
    return this;
  }
  sum() {
    let s = 0;
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) s += this.get(i, j);
    return s;
  }
  upTo(limit) {
    let s = 0;
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < this.columns; j++) {
        s += this.get(i, j);
        if (s > limit) return s;
        this.set(i, j, s);
      }
    }
    return s;
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
  other(m) { Object.setPrototypeOf(m, { get: (i, j) => 7 - i, set() { return this; }, scale: Matrix.prototype.scale, plusRow: Matrix.prototype.plusRow, fill2: Matrix.prototype.fill2, sum: Matrix.prototype.sum, upTo: Matrix.prototype.upTo }); },
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
        const m = new C(3, 3, fills[fill]), row = [0.5, -0, 2 ** 31];
        const results = [attempt(() => m.sum()), attempt(() => m.scale(1.5)), attempt(() => changes[change](m))];
        results.push(attempt(() => m.scale(0.25)), attempt(() => m.plusRow(row)), attempt(() => m.plusRow(m[0])), attempt(() => m.sum()), attempt(() => m.upTo(20)), dump(m));
        results.push(attempt(() => m.scale("2")), attempt(() => m.scale(NaN)), attempt(() => m.plusRow(["a", undefined])), attempt(() => m.sum()), attempt(() => m.fill2(m)), dump(m));
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
