import vm from "node:vm";

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
const context = vm.createContext({ list, Reflect, out: [] });
const made = vm.runInContext(`
  list.map((K, i) => { class Heir extends K { constructor(t) { super(t, "v" + i); this.heir = i; this.a0 = this.a0 ?? "none"; } who() { return "vm " + super.who(); } } return new Heir(i + 3); })
    .concat(list.map((K, i) => Reflect.construct(K, [i, "r"], list[(i + 1) % list.length])))
    .concat(list.map((K, i) => new K(i + 7, "n")))
`, context);
for (const o of made) show(o);
const Late = vm.runInThisContext(`(K => class Late extends K { constructor(t) { super(t, t * 2); this.late = t; } })`);
for (const K of list) { const L = Late(K); show(new L(4)); show(Reflect.construct(L, [5], list[0])); }
const evaluated = (0, eval)(`(K, N) => Reflect.construct(K, [6, "e"], N)`);
for (const K of list) for (const N of list) show(evaluated(K, N));
