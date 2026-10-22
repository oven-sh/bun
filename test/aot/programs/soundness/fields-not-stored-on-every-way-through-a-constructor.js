// Fields that are not stored on every way through a constructor, and objects that a constructor never finishes.
const out = [];
function show(name, ...v) { out.push(name + ": " + v.map(x => typeof x + " " + String(x)).join(", ")); }
function boom() { throw new Error("boom"); }
function fine() {}

class T1 { constructor(f) { try { f(); this.a = 1; } catch { } } }
show("try", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T1(boom).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T1(fine).a));
class T2 { constructor(f) { try { this.a = 1; f(); this.b = 2; } catch { this.c = 3; } } }
{ const p = new T2(boom), q = new T2(fine); show("try 2", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(p.a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(p.b), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(p.c), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(q.a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(q.b), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(q.c)); }
class T3 { constructor(c) { if (c) this.a = 1; this.b = 2; } }
show("if", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T3(false).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T3(true).a));
class T4 { constructor(c) { if (c) return; this.a = 1; } }
show("return", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T4(true).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T4(false).a));
class T5 { constructor(n) { for (let i = 0; i < n; i++) this.a = i; } }
show("loop", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T5(0).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T5(2).a));
class T6 { constructor(c) { c && (this.a = 1); c || (this.b = 2); } }
show("logical", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T6(false).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T6(true).b));
class T7 { constructor(k) { switch (k) { case 1: this.a = 1; break; case 2: this.a = 2; } } }
show("switch", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T7(3).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new T7(2).a));
class T8 { constructor(f) { try { f(); } finally { this.a = 1; } this.b = 2; } }
{ let kept; class T8b extends T8 { constructor(f) { try { super(f); } catch { } } } try { kept = new T8(boom); } catch { } show("finally", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(typeof kept)); }

let leaked9;
class T9 { constructor(f) { leaked9 = this; f(); this.v = 1; } }
try { new T9(boom); } catch { }
show("leaked and thrown", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(leaked9.v));
new T9(fine);
show("leaked", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(leaked9.v));

let leaked10;
class B10 { constructor() { leaked10 = this; } }
class D10 extends B10 { constructor(f) { super(); f(); this.v = 1; } }
try { new D10(boom); } catch { }
show("base leaks, derived throws", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(leaked10.v));

class B11 { constructor() { this.init(); } init() { } }
class D11 extends B11 { x = 5; init() { this.seen = this.x; } }
show("overridden method", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new D11().seen), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new D11().x));
class B12 { constructor() { this.seen = this.x; } }
class D12 extends B12 { x = 5; }
show("base reads", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new D12().seen));
class B13 { constructor() { this.seen = Object.keys(this).join(); } }
class D13 extends B13 { x = 5; }
show("base lists", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new D13().seen), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(Object.keys(new D13()).join()));

class F14 { a = this.b; b = 1; }
show("field order", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new F14().a));
class F15 { a = (() => this.b)(); b = 1; }
show("field arrow", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new F15().a));
class F16 { static make() { return new F16(); } a = F16.peek(this); b = 1; static peek(o) { return o.b; } }
show("static peek", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(F16.make().a));

class P17 { #p = this.#q(); #r = 1; #q() { try { return this.#r; } catch (e) { return e.constructor.name; } } get p() { return this.#p; } }
show("private", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new P17().p));

class B18 { constructor() { this.b = 1; } }
class D18 extends B18 { constructor() { super(); this.d = 2; } }
const o18 = Reflect.construct(B18, [], D18);
function rd18(q) { return q.d; }
show("Reflect.construct", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd18(o18)), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd18(new D18())), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(o18 instanceof D18), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(o18.b));

function F19() { } F19.prototype = D18.prototype;
const o19 = Reflect.construct(B18, [], F19);
show("prototype of another function", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd18(o19)), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(o19 instanceof D18));

const o20 = Object.create(D18.prototype);
show("Object.create", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd18(o20)), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(o20 instanceof D18));
const o21 = { __proto__: D18.prototype };
show("__proto__", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd18(o21)), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(o21.b));
const o22 = {}; Object.setPrototypeOf(o22, D18.prototype);
show("setPrototypeOf", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd18(o22)));

let cache23;
class R23 { constructor() { if (cache23) return cache23; cache23 = this; this.v = 1; } }
show("returns another", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new R23().v), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new R23().v));
class R24 { constructor() { this.v = 1; return { w: 2 }; } }
show("returns literal", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new R24().v), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new R24().w));
class B25 { constructor() { return Object.create(new.target.prototype); } }
class D25 extends B25 { x = 1; constructor() { super(); this.y = 2; } }
show("base returns", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new D25().x), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new D25().y));

function K26(c) { if (c) this.a = 1; }
show("function constructor", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new K26(false).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new K26(true).a));
function K27() { this.a = 1; }
const o27 = {}; K27.call(o27); const p27 = Object.create(K27.prototype);
function rd27(o) { return o.a; }
show("function called", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd27(o27)), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd27(new K27())), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(rd27(p27)));

class S28 { constructor(c) { c ? this.one() : this.two(); } one() { this.a = 1; } two() { this.b = 2; } }
show("two helpers", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new S28(true).b), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new S28(false).a));
class S29 { constructor(h) { h(this); } }
show("helper parameter", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new S29(o => { o.a = 1; }).a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new S29(o => { }).a));
class S30 { constructor(h) { this[h](); } one() { this.a = 1; } two() { } }
show("helper by key", (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new S30("one").a), (t => t === undefined ? "missing" : typeof t === "number" ? t + 1 : t)(new S30("two").a));

console.log(out.join("\n"));
