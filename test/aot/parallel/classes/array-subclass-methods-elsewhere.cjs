// Methods of a class that extends Array, called on what is no such instance or no longer one.
class Rows extends Array {
  constructor(n) { super(n); for (let i = 0; i < n; i++) this[i] = [i, i / 2]; this.rows = n; this.columns = 2; }
  get(i, j) { return this[i][j]; }
  set(i, j, v) { this[i][j] = v; return this; }
  total() { let t = 0; for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.columns; j++) t += this.get(i, j); return t; }
  lengths() { let t = 0; for (let i = 0; i < this.length; i++) t += this[i] === undefined ? 100 : this[i].length; return t; }
  fill2(v) { for (let i = 0; i < this.rows; i++) this.set(i, 1, v); return this.rows; }
}
const mixin = (S) => class Mixed extends S { total() { let t = 0; for (let i = 0; i < this.rows; i++) t += this.get(i); return t; } };
class OfMixin extends mixin(Array) { constructor(n) { super(n); for (let i = 0; i < n; i++) this[i] = i + 0.5; this.rows = n; } get(i) { return this[i]; } own() { let t = 0; for (let i = 0; i < this.rows; i++) t += this.get(i); return t; } }
function attempt(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
const { total, lengths, fill2 } = Rows.prototype, mixed = OfMixin.prototype.total, own = OfMixin.prototype.own;
for (let i = 0; i < 50; i++) { const m = new Rows(3); total.call(m); lengths.call(m); fill2.call(m, i); const o = new OfMixin(3); mixed.call(o); own.call(o); }
const makers = {
  plain: () => new Rows(3), other: () => Object.setPrototypeOf(new Rows(3), { get: (i, j) => i * 10 + j, set() { return this; } }), bare: () => Object.setPrototypeOf(new Rows(3), Array.prototype), none: () => Object.setPrototypeOf(new Rows(3), null),
  below: () => { class Below extends Rows { get(i, j) { return -super.get(i, j); } } return new Below(3); }, between: () => Object.setPrototypeOf(new Rows(3), Object.create(Rows.prototype, { get: { value: () => 7 } })),
  shadow: () => Object.assign(new Rows(3), { get: () => 5 }), accessor: () => Object.defineProperty(new Rows(3), "rows", { get: () => 2 }), gone: () => { const m = new Rows(3); delete m.rows; return m; }, late: () => { const m = new Rows(3); delete m.columns; m.columns = 1; return m; },
  list: () => Object.assign([[1, 2], [3, 4]], { rows: 2, columns: 2, get: Rows.prototype.get, set: Rows.prototype.set }), record: () => ({ 0: [1, 2], 1: [5, 6], length: 2, rows: 2, columns: 2, get: Rows.prototype.get, set: Rows.prototype.set }), proxy: () => new Proxy(new Rows(3), { get: (t, k, r) => (k === "rows" ? 1 : Reflect.get(t, k, r)) }),
  frozen: () => Object.freeze(new Rows(3)), text: () => "abc", nothing: () => undefined, mixed: () => new OfMixin(3), created: () => Object.create(Rows.prototype, { rows: { value: 1 }, columns: { value: 1 }, 0: { value: [9] } }), reflected: () => Reflect.construct(Rows, [2], class Other { get() { return 3; } }), sparse: () => { const m = new Rows(3); m[2000000] = 1; m.length = 3; return m; },
  swapped: () => Object.setPrototypeOf(new OfMixin(3), Rows.prototype), back: () => Object.setPrototypeOf(new Rows(3), OfMixin.prototype),
};
for (const name of Object.keys(makers)) {
  const answers = [];
  for (const f of [total, lengths, (m) => fill2.call(m, 8), total, mixed, own]) answers.push(attempt(() => f === mixed || f === own || f === total || f === lengths ? f.call(makers[name]()) : f(makers[name]())));
  const kept = attempt(() => 1) && (() => { try { return makers[name](); } catch { return undefined; } })();
  for (let i = 0; i < 30; i++) answers.push(attempt(() => total.call(kept)), attempt(() => own.call(kept)));
  console.log(name, [...new Set(answers)].join(), answers.length);
}
