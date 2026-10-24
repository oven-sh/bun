// Stores that reach an object through a computed __proto__, the receiver of Reflect.set, a proxy, or a generic array method.
const log = (...a) => console.log(a.map(String).join(" "));
const join = (...p) => p.join("");
class C1 { constructor() { this.v = 1; } m() { return "C"; } } { const o = new C1(); o[join("__pro", "to__")] = { m() { return "moved"; } }; log(1, o.m(), o instanceof C1, o.v, Object.keys(o).join()); }
class C2 { constructor() { this.v = 1; } m() { return "C"; } } { const o = new C2(); Object.assign(o, JSON.parse('{"__proto__": {"x": 5}, "v": "s"}')); log(2, typeof o.m, o.x, o.v, o instanceof C2); }
class C3 { constructor() { this.v = 1; } m() { return "C"; } } { const o = new C3(); Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(o, { m() { return "moved"; } }); log(3, o.m()); }
class C4 { constructor() { this.v = 1; } m() { return "C"; } } { const o = new C4(); Object.prototype.__lookupSetter__("__proto__").call(o, null); log(4, typeof o.m, o.v); }
class C5 { constructor() { this.v = 1; } m() { return "C"; } } { const o = new C5(); Reflect.set({}, "v", "by receiver", o); Reflect.set({}, "w", 2, o); log(5, o.v, o.w, Object.keys(o).join()); }
class C6 { constructor() { this.v = 1; } m() { return "C"; } } { Reflect.set({}, "m", () => "by receiver", C6.prototype); log(6, new C6().m()); }
class C7 { constructor() { this.v = 1; } m() { return "C"; } } { const o = new C7(); const p = new Proxy(o, {}); p.v = "through proxy"; delete p.v; p.z = 1; log(7, o.v, o.z, Object.keys(o).join()); Object.setPrototypeOf(p, null); log(7, typeof o.m); }
class C8 { constructor() { this.v = 1; this.length = 0; } } { const o = new C8(); Array.prototype.push.call(o, "a", "b"); log(8, o.length, o[0], o[1], Object.keys(o).join()); Array.prototype.pop.call(o); log(8, o.length, Object.keys(o).join()); }
class C9 { constructor() { this.v = 1; } } { const o = new C9(); const r = Array.from.call(function () { return o; }, ["x", "y"]); log(9, r === o, o.length, o[1], Object.keys(o).join()); }
class C10 { constructor() { this.lastIndex = 5; this.flags = ""; } exec() { return null; } } { const o = new C10(); RegExp.prototype[Symbol.replace].call(o, "s", "r"); o.flags = "g"; RegExp.prototype[Symbol.replace].call(o, "s", "r"); log(10, o.lastIndex); }
class C11 { constructor() { this.stack = 11; } twice() { return this.stack * 2; } } { const o = new C11(); log(11, o.twice()); Error.captureStackTrace(o); log(11, typeof o.stack, Number.isNaN(o.twice())); }
class C12 { constructor() { this.v = 1; } } { const o = new C12(); o.__defineGetter__("v", () => "getter"); log(12, o.v); Object.prototype.__defineSetter__.call(o, "w", function (x) { this.got = x; }); o.w = 3; log(12, o.got, Object.keys(o).join()); }
class C13 { constructor() { this.v = 1; } m() { return "C"; } } { C13.prototype.__defineGetter__("m", () => () => "getter"); log(13, new C13().m()); }
class A14 { set v(x) { this.caught = x; } } class C14 extends A14 { constructor() { super(); Object.defineProperty(this, "v", { value: 1, writable: true, configurable: true, enumerable: true }); } } { const o = new C14(); delete o.v; o.v = 9; log(14, o.v, o.caught); }
class C15 { constructor() { this.v = 1; } } { const o = new C15(); const child = Object.create(o); child.v = 2; log(15, o.v, child.v); Object.freeze(o); try { child.w = 1; child.v = 3; const c2 = Object.create(o); c2.v = 5; log(15, c2.v); } catch (e) { log(15, e.constructor.name); } }
class C16 { static n = 1; static get() { return C16.n; } } { Reflect.set({}, "n", "by receiver", C16); log(16, C16.get()); Object.assign(C16, { n: "assigned", get: () => "replaced" }); log(16, C16.get(), C16.n); }
{ const o = { a: 1, b: 2 }; for (const k of ["a", "b", join("__pro", "to__")]) o[k] = { z: k }; log(17, o.a.z, o.z, Object.keys(o).join()); }
{ const o = { a: 1 }; const src = { get a() { delete o.b; o.c = "added"; return "from getter"; }, b: "b" }; o.b = 0; Object.assign(o, src); log(18, JSON.stringify(o)); }
{ const o = { a: 1, b: 2 }; const e = Object.entries(o); e[0][1] = "changed"; log(19, o.a, e.join(";")); const d = Object.getOwnPropertyDescriptor(o, "a"); d.value = 9; log(19, o.a); }
{ function F() { this.a = 1; } const b = F.bind(null); const o = new b(); log(20, o.a, o instanceof F, o instanceof b); F.prototype.x = "late"; log(20, o.x); }
