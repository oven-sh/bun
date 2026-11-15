// Classes below mixins that are evaluated over Array, over Object and over classes of the program.
const log = [];
const mixin = (S) => class Mixed extends (S === undefined ? Object : S) {
  get cells() { return this.rows * this.columns; }
  static make(r, c) { return new this(r, c); }
  total() { let t = 0; for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) t += this.get(i, j); return t; }
  times(o) { const r = new this.constructor(this.rows, o.columns); for (let j = 0; j < o.columns; j++) for (let i = 0; i < this.rows; i++) { let s = 0; for (let k = 0; k < this.columns; k++) s += this.get(i, k) * o.get(k, j); r.set(i, j, s); } return r; }
};
class Matrix extends mixin(Array) {
  constructor(r, c) {
    if (arguments.length === 1 && typeof r === "number") return new Array(r);
    if (r instanceof Matrix) return r.copy();
    super(r);
    for (let i = 0; i < r; i++) { this[i] = []; for (let j = 0; j < c; j++) this[i][j] = i - j / 2; }
    this.rows = r; this.columns = c;
    return this;
  }
  get(i, j) { return this[i][j]; }
  set(i, j, v) { this[i][j] = v; return this; }
  copy() { const m = new Matrix(this.rows, this.columns); for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) m.set(i, j, this.get(i, j)); return m; }
}
class View extends mixin() { constructor(m) { super(); this.matrix = m; this.rows = m.columns; this.columns = m.rows; } get(i, j) { return this.matrix.get(j, i); } set(i, j, v) { this.matrix.set(j, i, v); return this; } }
class Base { constructor(r, c) { this.held = new Map(); this.made = [r, c].join(); } }
class Sparse extends mixin(Base) { constructor(r, c) { super(r, c); this.rows = r; this.columns = c; } get(i, j) { return this.held.get(i * 100 + j) || 0; } set(i, j, v) { this.held.set(i * 100 + j, v); return this; } }
const pick = (S) => (S === Array ? class Other { constructor(r) { this.rows = r; this.columns = 1; } total() { return -1; } } : mixin(S));
class Picked extends pick(Array) { get(i, j) { return this[i] === undefined ? 5 : this[i][j]; } set(i, j, v) { this[i] = [v]; return this; } }
function attempt(f) { try { const v = f(); return v && typeof v === "object" ? (Array.isArray(v) ? "list " : "") + v.constructor.name + " " + JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name; } }
function use(m, n) { let t = 0; for (let i = 0; i < n; i++) { t += m.get(i % 2, i % 2); if (i % 5 === 4) m.set(i % 2, 0, i / 4); } return t; }
const a = new Matrix(3, 2), b = Matrix.make(2, 3), t = new View(a);
for (let i = 0; i < 20; i++) {
  a.times(b); b.times(a); t.total(); a.times(t); use(a, 10); use(t, 10);
}
for (const f of [() => a, () => a.times(b), () => b.times(a).total(), () => t.times === a.times, () => t.total(), () => t.cells + a.cells, () => a.times(t), () => t.get(1, 1), () => new Matrix(2), () => new Matrix(a), () => new Matrix(a) === a, () => a instanceof Array, () => t instanceof Array, () => Object.getPrototypeOf(Matrix).name,
  () => Sparse.make(2, 2).set(0, 0, 4).set(1, 1, 5).total(), () => new Sparse(2, 2).made, () => use(new Sparse(2, 2), 12), () => new Picked(3).total(), () => new Picked(3).set(1, 0, 8).get(1, 0), () => Array.isArray(new Picked(2)), () => use(new Picked(2), 12)]) console.log(attempt(f), attempt(f));
const changes = [() => { delete a.rows; }, () => { a.rows = 2; a.columns = "2"; }, () => { a[0] = undefined; }, () => { a.length = 1; }, () => { Matrix.prototype.get = function (i, j) { log.push(i); return 1; }; }, () => { Object.defineProperty(b, "rows", { get() { log.push("rows"); return 1; }, configurable: true }); }, () => { Object.setPrototypeOf(b, View.prototype); b.matrix = a; },
  () => { Object.setPrototypeOf(Matrix, class { constructor(r) { this.only = r; } }); }, () => { Object.setPrototypeOf(Matrix.prototype, { total() { return "other"; }, times: mixin(Object).prototype.times }); }];
for (const change of changes) {
  console.log(attempt(change), attempt(() => a.total()), attempt(() => b.total()), attempt(() => a.times(b)), attempt(() => use(a, 12)), attempt(() => use(b, 12)), attempt(() => t.total()), attempt(() => new Matrix(2, 2)), a.length, Array.isArray(b), log.length);
}
