// Methods of a class that extends Array, called on what is no such instance or no longer one.
class Strips extends Array {
  constructor(n) { super(n); for (let i = 0; i < n; i++) this[i] = [i, i / 2]; this.tall = n; this.wide = 2; }
  patch(i, j) { return this[i][j]; }
  sew(i, j, v) { this[i][j] = v; return this; }
  total() { let t = 0; for (let i = 0; i < this.tall; i++) for (let j = 0; j < this.wide; j++) t += this.patch(i, j); return t; }
  lengths() { let t = 0; for (let i = 0; i < this.length; i++) t += this[i] === undefined ? 100 : this[i].length; return t; }
  fill2(v) { for (let i = 0; i < this.tall; i++) this.sew(i, 1, v); return this.tall; }
}
const mixin = (S) => class Mixed extends S { total() { let t = 0; for (let i = 0; i < this.tall; i++) t += this.patch(i); return t; } };
class OfMixin extends mixin(Array) { constructor(n) { super(n); for (let i = 0; i < n; i++) this[i] = i + 0.5; this.tall = n; } patch(i) { return this[i]; } own() { let t = 0; for (let i = 0; i < this.tall; i++) t += this.patch(i); return t; } }
function attempt(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
const { total, lengths, fill2 } = Strips.prototype, mixed = OfMixin.prototype.total, own = OfMixin.prototype.own;
for (let i = 0; i < 50; i++) { const m = new Strips(3); total.call(m); lengths.call(m); fill2.call(m, i); const o = new OfMixin(3); mixed.call(o); own.call(o); }
const makers = {
  plain: () => new Strips(3), other: () => Object.setPrototypeOf(new Strips(3), { patch: (i, j) => i * 10 + j, sew() { return this; } }), bare: () => Object.setPrototypeOf(new Strips(3), Array.prototype), none: () => Object.setPrototypeOf(new Strips(3), null),
  below: () => { class Below extends Strips { patch(i, j) { return -super.patch(i, j); } } return new Below(3); }, between: () => Object.setPrototypeOf(new Strips(3), Object.create(Strips.prototype, { patch: { value: () => 7 } })),
  shadow: () => Object.assign(new Strips(3), { patch: () => 5 }), accessor: () => Object.defineProperty(new Strips(3), "tall", { get: () => 2 }), gone: () => { const m = new Strips(3); delete m.tall; return m; }, late: () => { const m = new Strips(3); delete m.wide; m.wide = 1; return m; },
  list: () => Object.assign([[1, 2], [3, 4]], { tall: 2, wide: 2, patch: Strips.prototype.patch, sew: Strips.prototype.sew }), record: () => ({ 0: [1, 2], 1: [5, 6], length: 2, tall: 2, wide: 2, patch: Strips.prototype.patch, sew: Strips.prototype.sew }), proxy: () => new Proxy(new Strips(3), { get: (t, k, r) => (k === "tall" ? 1 : Reflect.get(t, k, r)) }),
  frozen: () => Object.freeze(new Strips(3)), text: () => "abc", nothing: () => undefined, mixed: () => new OfMixin(3), created: () => Object.create(Strips.prototype, { tall: { value: 1 }, wide: { value: 1 }, 0: { value: [9] } }), reflected: () => Reflect.construct(Strips, [2], class Other { get() { return 3; } }), sparse: () => { const m = new Strips(3); m[2000000] = 1; m.length = 3; return m; },
  swapped: () => Object.setPrototypeOf(new OfMixin(3), Strips.prototype), back: () => Object.setPrototypeOf(new Strips(3), OfMixin.prototype),
};
for (const name of Object.keys(makers)) {
  const answers = [];
  for (const f of [total, lengths, (m) => fill2.call(m, 8), total, mixed, own]) answers.push(attempt(() => f === mixed || f === own || f === total || f === lengths ? f.call(makers[name]()) : f(makers[name]())));
  const kept = attempt(() => 1) && (() => { try { return makers[name](); } catch { return undefined; } })();
  for (let i = 0; i < 30; i++) answers.push(attempt(() => total.call(kept)), attempt(() => own.call(kept)));
  console.log(name, [...new Set(answers)].join(), answers.length);
}
