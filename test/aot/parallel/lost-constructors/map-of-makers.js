
class Base { constructor(tag) { this.tag = tag; this.made = new.target.name; this.log = []; } who() { return "base " + this.tag + " " + this.made; } }
class Mid extends Base { constructor(tag) { super(tag); this.mid = tag + 1; this.kind = new.target === Mid ? "own" : "other"; } who() { return "mid " + super.who() + " " + this.mid + " " + this.kind; } }
var A, B, C, D;
const init = (() => {
  A = class A extends Mid { constructor(tag, extra) { super(tag); this.a0 = extra; this.a1 = typeof extra; if (new.target !== A) this.a2 = new.target.name; } get sum() { return this.mid + (this.a0 | 0); } who() { return "A " + super.who() + " " + this.a0 + " " + this.a1 + " " + this.a2; } };
  B = class B extends Base { constructor(tag) { super(tag); this.b0 = tag * 2; this.a0 = "b"; } get sum() { return -this.b0; } who() { return "B " + super.who() + " " + this.b0 + " " + this.a0; } };
  C = class C extends A { constructor(tag) { super(tag, { deep: tag }); this.c0 = this.a0.deep; this.tag = "c" + tag; } who() { return "C " + super.who() + " " + this.c0; } };
  D = class D { constructor(tag) { this.d0 = tag; this.proto = Object.getPrototypeOf(this) === new.target.prototype; } who() { return "D " + this.d0 + " " + this.proto; } };
});
init();
const exportsOf = {};
for (const [name, get] of Object.entries({ A: () => A, B: () => B, C: () => C, D: () => D })) Object.defineProperty(exportsOf, name, { get, enumerable: true });
globalThis.kept = exportsOf;
const list = Object.keys(exportsOf).map(k => exportsOf[k]);
const show = o => { const keys = Object.keys(o).sort().map(k => k + "=" + (typeof o[k] === "object" ? JSON.stringify(o[k]) : String(o[k]))).join(","); console.log(Object.getPrototypeOf(o).constructor.name, typeof o.who === "function" ? o.who() : "-", o.sum, keys); };
const makers = new Map(list.map((K, i) => [K.name, K]));
function make(name, ...args) { const K = makers.get(name); return new K(...args); }
for (const name of ['A', 'B', 'C', 'D', 'A', 'C']) show(make(name, 3, name + '!'));
