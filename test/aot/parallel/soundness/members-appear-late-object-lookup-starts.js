// A lookup runs once before a member exists and once after. The lookup starts at the object that gets the member (super, a store to the holder itself), or the member is no answer to it.
function id(x) { return x; }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function own(o) { return Object.keys(o).join(","); }
// 1: super.x = v, the setter is defined on the parent's prototype between two stores
{ const log = []; class A {} class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("1a", own(b), b.x + 1, log.length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true }); const c = new B(); c.put(2); show("1b", own(c), c.hidden + 1, log.join()); }
// 2: super.x is read before and after a getter appears
{ class A {} class B extends A { take() { return super.x; } } const b = new B(); show("2a", b.take());
  Object.defineProperty(A.prototype, "x", { get() { return 2; }, configurable: true }); show("2b", b.take() + 1); }
// 3: super.m() before and after m is replaced
{ class A { m() { return "first"; } } class B extends A { m() { return super.m(); } } const b = new B(); show("3a", b.m().length);
  A.prototype.m = function () { return 3; }; show("3b", b.m() + 1); }
// 4: super.m is read before and after m is assigned
{ class A {} class B extends A { kind() { return typeof super.m; } run() { return super.m(); } } const b = new B(); show("4a", b.kind());
  A.prototype.m = function () { return 4; }; show("4b", b.kind(), b.run() + 1); }
// 5: a static super store
{ const log = []; class A {} class B extends A { static put(v) { super.x = v; } } B.put(1); show("5a", own(B), B.x + 1, log.length);
  delete B.x; Object.defineProperty(A, "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true }); B.put(2); show("5b", own(B), B.hidden + 1, log.join()); }
// 6: a computed super store
{ const log = []; const k = id("x"); class A {} class B extends A { put(v) { super[k] = v; } } const b = new B(); b.put(1); show("6a", own(b), b.x + 1, log.length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true }); const c = new B(); c.put(2); show("6b", own(c), c.hidden + 1, log.join()); }
// 7: the accessor is deleted between two stores
{ const log = []; class A { set x(v) { log.push(v); } } class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("7a", own(b), log.join());
  delete A.prototype.x; b.put(2); show("7b", own(b), b.x + 1, log.join()); }
// 8: the accessor is replaced by a data property between two stores
{ const log = []; class A { set x(v) { log.push(v); } } class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("8a", own(b), log.join());
  Object.defineProperty(A.prototype, "x", { value: 0, writable: true, configurable: true }); b.put(2); show("8b", own(b), b.x + 1, A.prototype.x, log.join()); }
// 9: the prototype of the home object is swapped between two stores
{ const log = []; class A {} class Z { set x(v) { log.push(v); } } class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("9a", own(b), b.x + 1, log.length);
  Object.setPrototypeOf(B.prototype, Z.prototype); const c = new B(); c.put(2); show("9b", own(c), log.join()); }
// 10: a data property that cannot be written appears between two stores
{ class A {} class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("10a", b.x + 1);
  Object.defineProperty(A.prototype, "x", { value: 0, writable: false, configurable: true }); const c = new B(); show("10b", attempt(() => c.put(2)), own(c).length); }
// 11: super in an object literal, the setter appears on the base
{ const log = []; const base = {}; const o = { __proto__: base, put(v) { super.x = v; } }; o.put(1); show("11a", own(o), log.length);
  Object.defineProperty(base, "x", { set(v) { log.push(v); }, configurable: true }); const p = { __proto__: o }; p.put(2); show("11b", own(p), log.join()); }
// 12: super in an object literal, a getter appears on the base
{ const base = {}; const o = { __proto__: base, take() { return super.x; } }; show("12a", o.take());
  Object.defineProperty(base, "x", { get() { return 12; }, configurable: true }); show("12b", o.take() + 1); }
// 13: the setter appears two levels above the home object
{ const log = []; class A {} class B extends A {} class C extends B { put(v) { super.x = v; } } const c = new C(); c.put(1); show("13a", own(c), c.x + 1, log.length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); }, configurable: true }); const d = new C(); d.put(2); show("13b", own(d), log.join()); }
// 14: a store to the class object itself, the setter appears on it
{ const log = []; class A {} function put(v) { A.x = v; } put(1); show("14a", A.x + 1, log.length);
  Object.defineProperty(A, "x", { set(v) { log.push(v); }, configurable: true }); put(2); show("14b", A.x, log.join()); }
// 15: a store to the prototype object itself, the setter appears on it
{ const log = []; class A {} function put(v) { A.prototype.x = v; } put(1); show("15a", new A().x + 1, log.length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); }, configurable: true }); put(2); show("15b", new A().x, log.join()); }
// 16: a store to an object that others inherit from, the setter appears on it
{ const log = []; const base = {}; const heir = Object.create(base); function put(v) { base.x = v; } put(1); show("16a", own(base), log.length);
  Object.defineProperty(base, "x", { set(v) { log.push(v); }, configurable: true }); put(2); show("16b", own(heir), log.join()); }
// 17: Reflect.set with a receiver of its own
{ const log = []; class A {} const target = {}; function put(v) { return Reflect.set(A.prototype, "x", v, target); } put(1); show("17a", own(target), target.x + 1, log.length);
  delete target.x; Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true }); put(2); show("17b", own(target), target.hidden + 1, log.join()); }
// 18: Reflect.get with a receiver of its own
{ class A {} const target = { tag: 18 }; function take() { return Reflect.get(A.prototype, "x", target); } show("18a", take());
  Object.defineProperty(A.prototype, "x", { get() { return this.tag; }, configurable: true }); show("18b", take() + 1); }
// 19: the setter is defined first, and every store runs it
{ const log = []; class A {} class B extends A { put(v) { super.x = v; } }
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true }); const b = new B(); b.put(1); b.put(2); show("19", own(b), b.hidden + 1, log.join()); }
// 20: an ordinary store from an instance, the setter appears on the prototype of its class
{ const log = []; class A { put(v) { this.x = v; } } const a = new A(); a.put(1); show("20a", own(a), a.x + 1, log.length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); this.hidden = v; }, configurable: true }); const c = new A(); c.put(2); show("20b", own(c), c.hidden + 1, log.join()); }
// 21: a read passes the place where an accessor without a getter appears
{ class G { get x() { return "above"; } } class A extends G {} const a = new A(); function take(o) { return o.x; } show("21a", take(a));
  Object.defineProperty(A.prototype, "x", { set(v) {}, configurable: true }); show("21b", take(a)); }
// 22: a store passes the place where an accessor without a setter appears
{ class A { put(v) { this.x = v; } } const a = new A(); a.put(1); show("22a", own(a));
  Object.defineProperty(A.prototype, "x", { get() { return 5; }, configurable: true }); const c = new A(); show("22b", attempt(() => c.put(2)), own(c).length); }
// 23: super.m above a constructor function whose prototype object is assigned
{ function F() {} F.prototype = { constructor: F }; class B extends F { kind() { return typeof super.m; } } const b = new B(); show("23a", b.kind());
  F.prototype.m = function () { return 1; }; show("23b", b.kind()); }
// 24: super.x = v above a constructor function whose prototype object is assigned
{ const log = []; function F() {} F.prototype = { constructor: F }; class B extends F { put(v) { super.x = v; } } const b = new B(); b.put(1); show("24a", own(b), log.length);
  Object.defineProperty(F.prototype, "x", { set(v) { log.push(v); }, configurable: true }); const c = new B(); c.put(2); show("24b", own(c), log.join()); }
// 25: `in` before and after an accessor without a getter appears
{ class A {} class B extends A {} const b = new B(); function has(o) { return "x" in o; } show("25a", has(b));
  Object.defineProperty(A.prototype, "x", { set(v) {}, configurable: true }); show("25b", has(b)); }
// 26: the method with the super store is called from two functions, one runs before and one after
{ const log = []; class A {} class B extends A { put(v) { super.x = v; } } function early(o) { o.put(1); } function late(o) { o.put(2); } const b = new B(); early(b); show("26a", own(b), log.length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); }, configurable: true }); const c = new B(); late(c); show("26b", own(c), log.join()); }
// 27: the store runs in the constructor of the subclass
{ const log = []; class A {} class B extends A { constructor(v) { super(); super.x = v; } } const b = new B(1); show("27a", own(b), log.length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); }, configurable: true }); const c = new B(2); show("27b", own(c), log.join()); }
// 28: super.x += 1 reads and stores
{ const log = []; class A {} class B extends A { bump() { super.x += 1; } } const b = new B(); b.bump(); show("28a", own(b), String(b.x), log.length);
  Object.defineProperty(A.prototype, "x", { get() { return 10; }, set(v) { log.push(v); }, configurable: true }); const c = new B(); c.bump(); show("28b", own(c), log.join()); }
// 29: the getter and the setter are defined by two operations, a store runs between them
{ const log = []; class A {} class B extends A { put(v) { super.x = v; } }
  Object.defineProperty(A.prototype, "x", { get() { return 1; }, configurable: true }); const b = new B(); show("29a", attempt(() => b.put(1)), own(b).length);
  Object.defineProperty(A.prototype, "x", { set(v) { log.push(v); }, configurable: true }); b.put(2); show("29b", own(b).length, log.join()); }
// 30: the member is read on the prototype object and on the class object themselves
{ class A {} function p() { return typeof A.prototype.m; } function s() { return typeof A.m; } show("30a", p(), s());
  A.prototype.m = function () {}; A.m = function () {}; show("30b", p(), s()); }
// 31: the setter comes from __defineSetter__
{ const log = []; class A {} class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("31a", own(b), log.length);
  A.prototype.__defineSetter__("x", function (v) { log.push(v); }); const c = new B(); c.put(2); show("31b", own(c), log.join()); }
// 32: the setter comes from Object.defineProperties
{ const log = []; class A {} class B extends A { put(v) { super.x = v; } } const b = new B(); b.put(1); show("32a", own(b), log.length);
  Object.defineProperties(A.prototype, { x: { set(v) { log.push(v); }, configurable: true } }); const c = new B(); c.put(2); show("32b", own(c), log.join()); }
// 33: a super store passes the place where a method is assigned
{ class A {} class B extends A { put(v) { super.m = v; } } const b = new B(); b.put(1); show("33a", own(b), b.m + 1);
  A.prototype.m = function () { return 33; }; const c = new B(); show("33b", c.m() + 1); c.put(2); show("33c", own(c), c.m + 1); }
// 34: a store through an object that nobody tracks
{ const log = []; class A {} globalThis.lostBox = new A(); const unknown = globalThis.lostBox; function put(o, v) { o.lost = v; } put(unknown, 1); show("34a", own(unknown), log.length);
  Object.defineProperty(A.prototype, "lost", { set(v) { log.push(v); }, configurable: true }); const c = new A(); put(c, 2); show("34b", own(c), log.join()); }
// 35: a super store whose base nobody tracks
{ const log = []; class A {} globalThis.lostBox = A; class B extends globalThis.lostBox { put(v) { super.lost = v; } } const b = new B(); b.put(1); show("35a", own(b), log.length);
  Object.defineProperty(A.prototype, "lost", { set(v) { log.push(v); }, configurable: true }); const c = new B(); c.put(2); show("35b", own(c), log.join()); }
// 36: a store site that only ever sees an object nobody tracks
{ const log = []; class A {} globalThis.lostBox = new A(); function put(o, v) { o.lost = v; } put(globalThis.lostBox, 1); show("36a", own(globalThis.lostBox), log.length);
  Object.defineProperty(A.prototype, "lost", { set(v) { log.push(v); }, configurable: true }); globalThis.lostBox = new A(); put(globalThis.lostBox, 2); show("36b", own(globalThis.lostBox), log.join()); }
// 37: a read site that only ever sees an object nobody tracks, an accessor without a getter appears
{ class G { get lost() { return "above"; } } class A extends G {} globalThis.lostBox = new A(); function take(o) { return o.lost; } show("37a", take(globalThis.lostBox));
  Object.defineProperty(A.prototype, "lost", { set(v) {}, configurable: true }); show("37b", take(globalThis.lostBox)); }
