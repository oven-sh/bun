// A lookup ends at a field that is assumed to be filled.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
function read(o) { return o.x; }
// 1: stored on one path of the constructor
{ class C { constructor(f) { if (f) this.x = 1; } } C.prototype.x = "proto"; function r(o) { return o.x; } show("1", r(new C(true)) + 1, r(new C(false)).length); }
// 2: the constructor leaves early
{ class C { constructor(f) { if (!f) return; this.x = 1; } } C.prototype.x = "proto"; function r(o) { return o.x; } show("2", r(new C(true)) + 1, r(new C(false)).length); }
// 3: stored by a helper that a subclass replaces
{ class C { constructor() { this.init(); } init() { this.x = 1; } } class D extends C { init() {} } C.prototype.x = "proto"; function r(o) { return o.x; } show("3", r(new C()) + 1, r(new D()).length); }
// 4: the object leaks before the store, and the reader runs then
{ const seen = []; function r(o) { return o.x; } function peek(o) { seen.push(typeof r(o)); } class C { constructor() { peek(this); this.x = 1; peek(this); } } C.prototype.x = "proto"; new C(); show("4", seen.join()); }
// 5: the constructor throws after the leak
{ let leaked; function r(o) { return o.x; } class C { constructor() { leaked = this; throw new Error("stop"); this.x = 1; } } C.prototype.x = "proto"; try { new C(); } catch (e) {} show("5", r(leaked).length); }
// 6: a getter above a field that is deleted in a function reached through that getter's result
{ const proto = { get x() { return () => "from getter"; } }; const o = { __proto__: proto, x: null }; function r(v) { return v.x; } show("6a", r(o)); delete chain(o).x; show("6b", r(o)()); }
// 7: an inherited field of a subclass instance
{ class B { constructor(f) { if (f) this.x = 1; } } class C extends B { constructor(f) { super(f); this.y = 2; } } B.prototype.x = "proto"; function r(o) { return o.x; } show("7", r(new C(true)) + 1, r(new C(false)).length); }
// 8: Reflect.construct: the constructor of the new target never runs
{ class A { constructor() { this.a = 1; } } class B { constructor() { this.x = 1; } } B.prototype.x = "proto"; function r(o) { return o.x; } show("8", r(new B()) + 1, r(Reflect.construct(A, [], B)).length); }
// 9: Object.create of the class prototype
{ class B { constructor() { this.x = 1; } } B.prototype.x = "proto"; function r(o) { return o.x; } show("9", r(new B()) + 1, r(Object.create(B.prototype)).length); }
// 10: a method of the same name above a field that is emptied late, called
{ class B { x() { return "method"; } } class C extends B { constructor() { super(); this.x = () => 7; } } const o = new C(); function call(v) { return v.x(); } show("10a", call(o) + 1); delete chain(o).x; show("10b", call(o).length); }
// 11: `in` with a field that goes away
{ const proto = {}; const o = { __proto__: proto, x: 1 }; function has(v) { return "x" in v; } show("11a", has(o)); delete chain(o).x; show("11b", has(o)); chain(proto).x = 1; show("11c", has(o)); }
// 12: a literal field under a key nobody can name is deleted, then the prototype gets the name late
{ const proto = {}; const o = { __proto__: proto, x: 1 }; function r(v) { return v.x; } show("12a", r(o) + 1); delete o[dynamic("x")]; show("12b", r(o)); chain(proto).x = "late"; show("12c", r(o).length); }
// 13: the field is emptied through a receiver nobody tracks, after the reader ran
{ const proto = { x: "proto" }; const o = { __proto__: proto, x: 1 }; function r(v) { return v.x; } show("13a", r(o) + 1); globalThis.lostBox13 = o; const u = globalThis.lostBox13; delete u[dynamic("x")]; show("13b", r(o).length); }
// 14: an accessor defined through a receiver nobody tracks
{ const o = { x: 1 }; function r(v) { return v.x; } show("14a", r(o) + 1); globalThis.lostBox14 = o; Object.defineProperty(globalThis.lostBox14, "x", { get() { return "getter"; } }); show("14b", r(o).length); }
