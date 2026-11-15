const attempt = f => { try { return f(); } catch (e) { return e.name; } };
function chain() {
  class B { constructor(x) { this._x = x; } get x() { return this._x; } set x(v) { this._x = v; } m(a) { return this._x + a; } static make(x) { return new this(x); } static get kind() { return "B"; } static count = 0; static bump() { return ++this.count; } }
  class C extends B { get x() { return super.x + 1; } set x(v) { super.x = v * 2; } m(a) { return super.m(a) + 1; } static make(x) { const o = super.make(x); o.made = true; return o; } static get kind() { return "C" + super.kind; } }
  class D extends C { get x() { return super.x * 2; } set x(v) { super.x = v + 1; } m(a) { const f = () => super.m(a); return f() + super.missing?.(1) ?? 0; } static get kind() { return super.kind + "D"; } }
  const list = [new B(1), new C(2), new D(3)]; let s = 0;
  for (let i = 0; i < 300; i++) { const o = list[i % 3]; o.x = i & 7; s += o.x + (i % 3 < 2 ? o.m(i) : 0); }
  const statics = [B, C, D].map(K => [K.kind, K.bump(), K.make(1).x, Object.hasOwn(K, "count")].join());
  console.log("chain", s, statics.join(" | "), C.make(4).made, Object.keys(D.make(1)).join());
  return { B, C, D, list };
}
const { B, C, D, list } = chain();
function changed() {
  let s = 0;
  for (let i = 0; i < 100; i++) { list[2].x = i; s += list[2].x; }
  Object.defineProperty(B.prototype, "x", { get() { return 100; }, set(v) { this.seen = v; }, configurable: true });
  for (let i = 0; i < 100; i++) { list[2].x = i; s += list[2].x; }
  Object.setPrototypeOf(D.prototype, { get x() { return 7; }, set x(v) { this.seen = v; } });
  for (let i = 0; i < 100; i++) { list[2].x = i; s += list[2].x; }
  Object.setPrototypeOf(D, null);
  console.log("changed", s, list[2].seen, attempt(() => D.kind), attempt(() => new D(1)));
}
changed();
function detached() {
  class P { get v() { return 1; } m() { return "P" + this.tag; } }
  class Q extends P { get v() { return super.v + 1; } m() { return super.m() + "Q"; } }
  const get = Object.getOwnPropertyDescriptor(Q.prototype, "v").get, m = Q.prototype.m; let s = 0;
  for (let i = 0; i < 100; i++) s += get.call({ tag: i }) + m.call({ tag: i }).length;
  console.log("detached", s, get.call(undefined), attempt(() => m.call(undefined)), m.call(5), new Q().m());
}
detached();
function assigned() {
  let K = class K { static #n = 1; static get n() { return K.#n; } who() { return K.n; } };
  const first = K, o = new K(); let s = 0;
  for (let i = 0; i < 100; i++) s += o.who();
  K = class { static n = 50; };
  for (let i = 0; i < 100; i++) s += o.who();
  console.log("assigned", s, first.n, K.n, first === o.constructor);
}
assigned();
function declared() {
  class K { static n = 1; who() { return K.n; } static swap() { try { K = null; } catch (e) { return e.name; } return "swapped"; } }
  const o = new K(); let s = 0; for (let i = 0; i < 100; i++) s += o.who();
  const before = K; const told = K.swap(); console.log("declared", s, told, o.who(), before.n, attempt(() => K.n));
  try { K = { n: 9 }; } catch (e) { console.log(e.name); }
  console.log(o.who(), K.n);
}
declared();
function heritage(Base) { return class extends Base { get v() { return (super.v ?? 0) + 1; } static get s() { return (super.s ?? 0) + 1; } m() { return super.m?.() ?? "none"; } }; }
{ const bases = [class { get v() { return 10; } static get s() { return 5; } m() { return "m"; } }, Object, class { }, Array, function F() {}]; const made = bases.map(heritage); const objects = made.map(M => new M()); let s = 0; for (let i = 0; i < 300; i++) { const k = i % 5; s += objects[k].v + made[k].s; } console.log("heritage", s, objects.map(o => o.m()).join()); console.log(attempt(() => heritage(null)), attempt(() => new (heritage(null))()), attempt(() => heritage(5))); }
function early() { return attempt(() => { class Y { static x = Y.name; static [(() => attempt(() => Y))()] = 1; } return Y.x + Object.keys(Y).join(); }); }
console.log("early", early());
function frozen() { class A { get v() { return 1; } static get s() { return 2; } } class F extends A { get v() { return super.v + 1; } static get s() { return super.s + 1; } } Object.freeze(F); Object.freeze(F.prototype); Object.freeze(A.prototype); const o = new F(); let s = 0; for (let i = 0; i < 100; i++) s += o.v + F.s; console.log("frozen", s, attempt(() => { "use strict"; F.prototype.v = 1; })); }
frozen();
function proxied() { class A { get v() { return this.k; } set v(x) { this.k = x; } } class G extends A { get v() { return super.v; } set v(x) { super.v = x; } } const log = []; const p = new Proxy(new G(), { get(t, k, r) { log.push("get " + String(k)); return Reflect.get(t, k, r); }, set(t, k, v, r) { log.push("set " + String(k)); return Reflect.set(t, k, v, r); }, defineProperty(t, k, d) { log.push("define " + String(k)); return Reflect.defineProperty(t, k, d); } }); let s = 0; for (let i = 0; i < 4; i++) { p.v = i; s += p.v; } console.log("proxied", s, log.join()); }
proxied();
