
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
for (const K of list) { const p = new Proxy(K, {}); show(new p(1, 2)); const q = new Proxy(K, { construct(t, args, n) { return Reflect.construct(t, [args[0] + 10, 'q'], list[(list.indexOf(t) + 1) % list.length]); } }); show(new q(5)); class Y extends p { constructor() { super(8, 9); this.y = 'y'; } } show(new Y()); }
