// What a class whose heritage is a parameter constructs, and everything that can be done to it, in loops.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, r); };
const M = B => class extends B { k = 1; hi(n) { return n + this.k; } get twice() { return this.k * 2; } };
const loop = (o, other) => { let s = 0; for (let i = 0; i < 300; i++) { const c = i % 7 === 6 && other !== undefined ? other : o; s += c.hi(i & 3); } return s; };
const gets = o => { let s = 0; for (let i = 0; i < 300; i++) s += o.twice + o.k; return s; };
class B0 { z = 1; }
class B1 { y = 2; hi(n) { return n - 1; } }
const C = M(B0), c = new C();
show("plain", () => loop(c)); show("plain get", () => gets(c));
const D = M(B1), d = new D();
show("second base", () => loop(d, c)); show("second base get", () => gets(d));
show("other object", () => loop(c, { hi(n) { return n * 100; } }));
show("base alone", () => loop(c, new B1()));
show("missing", () => loop(c, new B0()));
show("null", () => loop(c, null));
show("number", () => loop(c, 3));
{ const o = new C(); o.hi = n => n + 1000; show("own method", () => loop(c, o)); }
{ const o = new C(); Object.defineProperty(o, "hi", { get() { return n => n + 2000; } }); show("own accessor", () => loop(c, o)); }
{ const o = new C(); Object.setPrototypeOf(o, { hi(n) { return n + 3000; } }); show("another prototype", () => loop(c, o)); }
{ const o = new C(); Object.setPrototypeOf(o, null); show("no prototype", () => loop(c, o)); }
{ const o = new C(); delete o.k; show("deleted field", () => [loop(o), gets(o)].join()); }
{ const o = new C(); Object.defineProperty(o, "k", { get() { return 50; } }); show("accessor field", () => [loop(o), gets(o)].join()); }
{ const o = new C(); o.k = "text"; show("text field", () => String(loop(o)).slice(0, 20)); }
{ const o = Object.freeze(new C()); show("frozen", () => loop(o)); }
{ const o = new Proxy(new C(), { get(t, k, r) { return k === "hi" ? n => n + 4000 : Reflect.get(t, k, r); } }); show("proxy", () => loop(c, o)); }
{ const o = Object.create(c); show("created below", () => loop(c, o)); }
{ const o = structuredClone({ k: 4 }); o.hi = C.prototype.hi; show("borrowed", () => loop(c, o)); }
for (const [label, B] of [
  ["returns literal", class { constructor() { return { hi: n => n + 7, k: 3, twice: 8 }; } }],
  ["returns other instance", class { constructor() { return new B1(); } }],
  ["returns list", class { constructor() { return Object.assign([1, 2], { hi: n => n * 2 }); } }],
  ["returns function", class { constructor() { return Object.assign(() => 1, { hi: n => n * 3 }); } }],
  ["returns frozen", class { constructor() { return Object.freeze({ hi: n => n }); } }],
  ["returns proxy", class { constructor() { return new Proxy({ hi: n => n + 9 }, {}); } }],
  ["returns old", (() => { const old = new C(); return class { constructor() { return old; } }; })()],
  ["returns primitive", class { constructor() { return 3; } }],
  ["calls method early", class { constructor() { this.early = this.hi(1); } }],
  ["sets prototype", class { constructor() { Object.setPrototypeOf(this, { hi: n => n + 11 }); } }],
  ["hides method", class { hi = n => n + 12; }],
  ["hides field", class { k = 5; }],
  ["freezes", class { constructor() { Object.freeze(this); } }],
  ["prevents", class { constructor() { Object.preventExtensions(this); } }],
  ["function", function () { this.z = 4; }],
  ["function with method", Object.assign(function () { this.z = 4; }, {})],
  ["bound", B0.bind(null)],
  ["proxied class", new Proxy(B0, {})],
  ["proxied construct", new Proxy(B0, { construct: (t, a, n) => ({ hi: x => x + 13 }) })],
  ["map", Map], ["array", Array], ["error", Error], ["date", Date], ["object", Object], ["function class", Function],
  ["null", null], ["undefined", undefined], ["arrow", () => 1], ["number", 5],
]) show(label, () => { const X = M(B); const x = new X(); return [loop(x), gets(x), x.early, x instanceof C, x instanceof X, Object.keys(x).join("+")].join(" "); });
show("reflect other target", () => { const o = Reflect.construct(B0, [], C); return [loop(o), o.k, o.z].join(" "); });
show("reflect below", () => { class E extends C { hi(n) { return super.hi(n) + 20; } } const o = Reflect.construct(C, [], E); return [loop(c, o), loop(o)].join(" "); });
show("reflect literal target", () => { function F() {} F.prototype = { hi: n => n + 30 }; const o = Reflect.construct(C, [], F); return [loop(c, o), o.k, o.z].join(" "); });
show("class object linked", () => { const X = M(B0); Object.setPrototypeOf(X, class { q = 6; hi(n) { return 1; } }); const x = new X(); return [loop(x), x.q, x.z, x.k].join(" "); });
show("prototype linked", () => { const X = M(B0); Object.setPrototypeOf(X.prototype, { zz: 4 }); const x = new X(); return [loop(x), x.zz].join(" "); });
show("early", () => { const N = B => class extends B { constructor() { const f = () => this; try { f(); } catch (e) { var m = e.name; } super(); this.m = m; } hi(n) { return n; } }; const X = N(B0), x = new X(); return [loop(x), x.m].join(" "); });
show("twice", () => { const N = B => class extends B { constructor() { super(); super(); } }; return new (N(B0))(); });
show("never", () => { const N = B => class extends B { constructor() { } }; return new (N(B0))(); });
show("uncalled", () => C());
show("made in loop", () => { let s = 0; for (let i = 0; i < 300; i++) { const X = M(i & 1 ? B0 : B1); s += new X().hi(i & 3); } return s; });
show("heirs", () => { class E extends C { hi(n) { return super.hi(n) + 1; } } class G extends D { k = 4; } let s = 0; const os = [new E(), new G(), c, d]; for (let i = 0; i < 300; i++) s += os[i & 3].hi(i); return s; });
show("replaced on one", () => { C.prototype.hi = function (n) { return n + this.k + 40; }; return [loop(c), loop(d), loop(d, c)].join(" "); });
show("removed from one", () => { delete C.prototype.hi; return loop(d, c); });
show("laid on base", () => { B0.prototype.hi = function (n) { return this.z + n + 60; }; return [loop(c), loop(d, c)].join(" "); });
show("accessor on one", () => { Object.defineProperty(D.prototype, "hi", { get() { return n => n + 70; }, configurable: true }); return [loop(d), loop(d, c)].join(" "); });
