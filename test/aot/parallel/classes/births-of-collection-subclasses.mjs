// Births of classes that extend Map and Set, and of classes below a subclass of Array: what super() is given, and what changes between two births.
const out = [];
function one(v) { return Object.is(v, -0) ? "-0" : Array.isArray(v) ? v.constructor.name + "[" + Array.from(v, one).join() + "]" : v instanceof Map ? v.constructor.name + "{" + [...v].join(";") + "}" : v instanceof Set ? v.constructor.name + "{" + [...v].join() + "}" : typeof v === "function" ? "f" : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
const gc = () => { if (typeof Bun !== "undefined") Bun.gc(true); };
class M extends Map {}
class MF extends Map { hits = 0; misses; constructor(...a) { super(...a); this.made = 1; } }
class M0 extends Map { constructor() { super(); this.a = 1; } sum() { let s = 0; for (const [k, v] of this) s += k * v; return s + this.a; } }
class M1 extends Map { constructor(x) { super(x); } }
class MP extends Map { #p = 1; #q = []; add(k) { this.#p++; this.#q.push(k); return this.set(k, this.#p); } get told() { return this.#p + this.#q.join(); } }
class MM extends M0 { constructor() { super(); this.b = 2; } set(k, v) { return super.set(k, v + 1); } }
class S extends Set {}
class SS extends S { constructor(x) { super(x); this.kind = "ss"; } add(v) { return super.add(v * 2); } }
class A extends Array { constructor(n) { super(n); this.a = 1; } total() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s + this.a; } }
class B extends A { constructor(n) { super(n); this.b = 2; for (let i = 0; i < this.length; i++) this[i] = i + 0.5; } }
class C extends B { c = 3; constructor(n) { super(n); this[0] = "c"; } }
class D extends A {}
class P extends Array { #a = 1; #b = 2; sum() { return this.#a++ + this.#b + this.length; } }
class PP extends P { #a = 10; own() { return this.#a++ + this.sum(); } }
class Answers extends Map { constructor(o) { super(); if (o) return o; } }
function Old() { return Reflect.construct(Map, [], new.target ?? Old); } Object.setPrototypeOf(Old.prototype, Map.prototype);
function births(round) {
  const l = [];
  for (let i = 0; i < 70; i++) {
    const m = new M(); m.set(i, round); const n = new M0(); n.set(2, i); n.set(3, 4); const x = new M1(i & 1 ? [[i, 1]] : i & 2 ? null : undefined); const f = new MF(); f.hits += i;
    const p = new MP(); p.add(i).add(i + 1); const mm = new MM(); mm.set(1, i); const s = new S(); s.add(i); const ss = new SS(i & 1 ? [i] : undefined); ss.add(i);
    if (i % 23 === 0) l.push(m, n.sum(), x, f.hits + one(f.misses) + f.made + f.size, p.told, mm.sum() + mm.b, s, ss, ss.kind, m instanceof M, n.constructor.name, Object.getPrototypeOf(mm) === MM.prototype, Object.keys(f).join());
    const a = new A(i & 3), b = new B(i & 3), c = new C(1 + (i & 3)), d = new D(2), q = new P(i & 3), qq = new PP();
    a.fill(i); d[0] = i; d[1] = "d"; qq.push(i);
    if (i % 23 === 0) l.push(a, a.total(), b, b.total() + b.b, c, c.c, d, d.total(), q.sum() + q.sum(), qq.own() + qq.own(), qq, 1 in new D(2), Object.keys(b).length);
  }
  return l.map(one).join(" ");
}
for (let round = 0; round < 3; round++) { out.push(births(round)); gc(); }
out.push(attempt(() => new M([[1, 2], [3, 4]])), attempt(() => new M(5)), attempt(() => new S("abc")), attempt(() => M()), attempt(() => Reflect.construct(M, [], MM)), attempt(() => Object.getPrototypeOf(Reflect.construct(Map, [], M0)) === M0.prototype), attempt(() => Reflect.construct(M0, [], Array)), attempt(() => Reflect.construct(A, [2], Map)), attempt(() => Reflect.construct(Map, [], B).get(1)));
const kept = new Map([[1, 1]]); out.push(one(new Answers(kept) === kept), one(new Answers()), one(new Answers() instanceof Answers));
for (let i = 0; i < 80; i++) { const o = new Old(); if (i === 79) out.push(one(o.set(1, 2).size), o instanceof Old); } Old.prototype = { __proto__: Map.prototype, tag: "later" }; out.push(new Old().tag);
class Moved extends Map { constructor() { super(); } kind() { return this instanceof Map ? "map" : this instanceof Set ? "set" : Array.isArray(this) ? "array" : "other"; } }
for (let i = 0; i < 80; i++) new Moved(); Object.setPrototypeOf(Moved, Set); out.push(attempt(() => new Moved().kind()), attempt(() => Moved.prototype.add)); Object.setPrototypeOf(Moved, Array); out.push(attempt(() => new Moved().kind())); Object.setPrototypeOf(Moved, Map); out.push(attempt(() => new Moved().kind()));
Object.setPrototypeOf(M0.prototype, { __proto__: Map.prototype, get size() { return "own"; } }); out.push(new M0().size + one(new M0().set(1, 1).sum())); Object.setPrototypeOf(M0.prototype, Map.prototype); out.push(new M0().size);
Object.defineProperty(B.prototype, "1", { get() { return "above"; }, set(v) { this.stored = v; }, configurable: true }); out.push(births(9), one(new D(3)), one(new B(3).stored)); delete B.prototype[1]; out.push(births(10));
const many = []; for (let i = 0; i < 20000; i++) { const m = new MP(); if (!(i % 100)) many.push(m.add(i)); if (!(i % 5000)) gc(); } out.push(many.length + many[7].told + many.at(-1).size);
for (const l of out) console.log(l);
