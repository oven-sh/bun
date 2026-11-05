function say(n, f) { let r; try { r = JSON.stringify(f()); if (r === undefined) r = "undefined"; } catch (e) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
function make0(C) { return new C(); }
function make1(C, a) { return new C(a); }
function make2(C, a, b) { return new C(a, b); }
function make3(C, a, b, c) { return new C(a, b, c); }
function make4(C, a, b, c, d) { return new C(a, b, c, d); }
function make5(C, a, b, c, d, e) { return new C(a, b, c, d, e); }
function make6(C, a, b, c, d, e, f) { return new C(a, b, c, d, e, f); }
function make7(C, a, b, c, d, e, f, g) { return new C(a, b, c, d, e, f, g); }
function make9(C, a, b, c, d, e, f, g, h, i) { return new C(a, b, c, d, e, f, g, h, i); }
function makeSpread(C, list) { return new C(...list); }
const log = [];
function take() { return log.splice(0).join(","); }
class B { constructor(x) { log.push("B " + (new.target && new.target.name)); this.x = x; } who() { return "B"; } }
class D extends B { constructor(x, y) { log.push("D before " + new.target.name); super(x); log.push("D after"); this.y = y; } who() { return "D" + super.who(); } }
class E extends D { constructor(x, y, z) { super(x, y); this.z = z; } who() { return "E" + super.who(); } }
function F(x) { this.x = x; }
F.prototype.who = function () { return "F"; };
// So that the sites have seen ordinary constructors, derived ones and values that are not closures of the program.
for (let i = 0; i < 40; i++) { make0(B); make0(F); make0(Object); make1(B, i); make1(F, i); make1(D, i); make2(D, i, i); make2(B, i, i); make3(E, i, i, i); make3(B, i, i, i); make3(Array, 1, 2, 3); } log.length = 0;
say("one level", () => { const o = make2(D, 1, 2); return [o.x, o.y, o.who(), o instanceof D, o instanceof B, Object.getPrototypeOf(o) === D.prototype, Object.keys(o), o.constructor === D, take()]; });
say("two levels", () => { const o = make3(E, 1, 2, 3); return [o.x, o.y, o.z, o.who(), o instanceof E, Object.getPrototypeOf(o) === E.prototype, Object.keys(o), take()]; });
say("by turns at one site", () => { let t = []; for (const C of [B, D, F, E, D, B, E, F]) { const o = make3(C, 1, 2, 3); t.push(o.who() + Object.keys(o).join("")); } log.length = 0; return t; });
say("in a loop", () => { let t = 0; for (let i = 0; i < 3000; i++) { const o = make3(i & 1 ? E : D, i, 1, 2); t += o.x + o.y + (o.z || 0); } log.length = 0; return t; });
// The number of arguments compared with the number of parameters and of registers; new.target is not an argument.
class Counts extends B { constructor(a, b) { super(a); this.n = arguments.length; this.list = Array.prototype.slice.call(arguments); this.b = b; } }
class Rest extends B { constructor(a, ...rest) { super(a); this.rest = rest; } }
class Defaults extends B { constructor(a = "da", b = "db") { super(a); this.b = b; } }
class Implicit extends Counts { }
class ImplicitTwice extends Implicit { }
class Nine extends B { constructor(a, b, c, d, e, f, g, h, i) { super(a); this.all = [a, b, c, d, e, f, g, h, i]; } }
for (const C of [Counts, Rest, Defaults, Implicit, ImplicitTwice, Nine]) {
    say(C.name + ", 0 to 9 arguments", () => { const all = [make0(C), make1(C, 1), make2(C, 1, 2), make3(C, 1, 2, 3), make4(C, 1, 2, 3, 4), make5(C, 1, 2, 3, 4, 5), make6(C, 1, 2, 3, 4, 5, 6), make7(C, 1, 2, 3, 4, 5, 6, 7), make9(C, 1, 2, 3, 4, 5, 6, 7, 8, 9), makeSpread(C, [1, 2, 3]), makeSpread(C, [])]; log.length = 0; return all; });
}
say("length and name are the declaration's", () => [D.length, E.length, Counts.length, Rest.length, Defaults.length, Implicit.length, D.name]);
// The body's completion.
const other = { other: true };
class ReturnsObject extends B { constructor() { super(1); return other; } }
class ReturnsObjectWithoutSuper extends B { constructor() { return other; } }
class ReturnsFunction extends B { constructor() { super(1); return F; } }
class ReturnsUndefined extends B { constructor() { super(1); return undefined; } }
class ReturnsNull extends B { constructor() { super(1); return null; } }
class ReturnsNumber extends B { constructor() { super(1); return 1; } }
class ReturnsString extends B { constructor() { super(1); return "s"; } }
class ReturnsNumberWithoutSuper extends B { constructor() { return 1; } }
class NoSuper extends B { constructor() { log.push("ran"); } }
class SuperTwice extends B { constructor() { super(1); log.push("between"); super(2); } }
class ThisBeforeSuper extends B { constructor() { this.x = 1; super(1); } }
class SuperInArrow extends B { constructor() { const f = () => super(7); f(); this.y = 1; } }
class SuperInBranch extends B { constructor(yes) { if (yes) super(1); else return other; } }
class SuperInTry extends B { constructor() { try { throw 1; } catch { super(3); } finally { log.push("finally"); } } }
say("returns an object", () => [make0(ReturnsObject) === other, take()]);
say("returns an object, no super", () => [make0(ReturnsObjectWithoutSuper) === other, take()]);
say("returns a function", () => [make0(ReturnsFunction) === F, take()]);
say("returns undefined", () => [make0(ReturnsUndefined).x, make0(ReturnsUndefined) instanceof ReturnsUndefined]);
for (const C of [ReturnsNull, ReturnsNumber, ReturnsString, ReturnsNumberWithoutSuper, NoSuper, SuperTwice, ThisBeforeSuper]) { log.length = 0; say(C.name, () => make0(C)); say(C.name + ", what ran", take); }
say("super in an arrow", () => { const o = make0(SuperInArrow); return [o.x, o.y, o instanceof SuperInArrow]; });
say("super in a branch", () => [make1(SuperInBranch, true).x, make1(SuperInBranch, false) === other]);
say("super in a catch", () => { log.length = 0; return [make0(SuperInTry).x, take()]; });
// Fields, private names, accessors: made when `super(..)` returns.
class Fields extends B { a = log.push("field a") && this.x; #p = 5; static s = 1; constructor(x) { log.push("before"); super(x); log.push("after " + this.a); } get p() { return this.#p; } static is(o) { return #p in o; } }
class FieldsOnly extends Fields { c = this.a + 1; }
say("fields", () => { log.length = 0; const o = make1(Fields, 4); return [o.a, o.p, Fields.is(o), Fields.is({}), Object.keys(o), take()]; });
say("fields of an heir without a constructor", () => { log.length = 0; const o = make1(FieldsOnly, 4); return [o.a, o.c, o.p, Object.keys(o), take()]; });
// The possible `extends` expressions.
class OfFunction extends F { constructor(x) { super(x); this.y = 1; } }
class OfError extends Error { constructor(m) { super(m); this.code = 7; } }
class OfTypeError extends TypeError { }
class OfArray extends Array { constructor(...a) { super(...a); this.tag = "t"; } }
class OfMap extends Map { constructor(e) { super(e); this.tag = "m"; } }
class OfPromise extends Promise { }
class OfObject extends Object { constructor() { super(); this.o = 1; } }
class OfNull extends null { constructor() { super(); } }
class OfNullImplicit extends null { }
class OfNullReturning extends null { constructor() { return Object.create(OfNullReturning.prototype); } }
class OfProxy extends (new Proxy(B, { construct(t, a, n) { log.push("trap " + n.name); return Reflect.construct(t, a, n); } })) { constructor(x) { super(x); } }
const Bound = B.bind(null, "bound"); Bound.prototype = B.prototype;
class OfBound extends Bound { constructor() { super(); } }
const mixin = Base => class Mixed extends Base { constructor(...a) { super(...a); this.mixed = Base.name; } };
const MixedB = mixin(B), MixedD = mixin(D), MixedTwice = mixin(mixin(F));
say("extends a plain function", () => { const o = make1(OfFunction, 3); return [o.x, o.y, o.who(), o instanceof F]; });
say("extends Error", () => { const e = make1(OfError, "m"); return [e.message, e.code, e instanceof Error, e instanceof OfError, e.name, typeof e.stack, Object.prototype.toString.call(e)]; });
say("extends TypeError, no constructor", () => { const e = make1(OfTypeError, "m"); return [e.message, e instanceof TypeError, e instanceof OfTypeError]; });
say("extends Array", () => { const a = make3(OfArray, 1, 2, 3); a.push(4); return [a.length, a.tag, Array.isArray(a), a instanceof OfArray, a.map(x => x * 2) instanceof OfArray, make1(OfArray, 3).length]; });
say("extends Map", () => { const m = make1(OfMap, [[1, 2]]); return [m.get(1), m.size, m.tag, m instanceof OfMap]; });
say("extends Promise", () => { const p = make1(OfPromise, r => r(1)); return [p instanceof OfPromise, p.then(() => 1) instanceof OfPromise]; });
say("extends Object", () => { const o = make0(OfObject); return [o.o, o instanceof OfObject]; });
say("extends null", () => make0(OfNull));
say("extends null, no constructor", () => make0(OfNullImplicit));
say("extends null and returns an object", () => make0(OfNullReturning) instanceof OfNullReturning);
say("extends a proxy", () => { log.length = 0; const o = make1(OfProxy, 5); return [o.x, o instanceof OfProxy, take()]; });
say("extends a bound function", () => { log.length = 0; const o = make0(OfBound); return [o.x, o instanceof OfBound, o instanceof B, take()]; });
say("extends a bound function that has no prototype", () => { class X extends B.bind(null) { } return make0(X); });
say("extends what is no constructor", () => { class X extends (() => 1) { } return make0(X); });
say("mixins", () => { log.length = 0; const a = make1(MixedB, 1), b = make2(MixedD, 1, 2), c = make1(MixedTwice, 9); log.length = 0; return [a.x, a.mixed, b.y, b.mixed, b.who(), c.x, c.mixed, MixedB === MixedD, a instanceof MixedB, a instanceof MixedD]; });
// new.target.
class Target extends B { constructor() { super(0); this.t = new.target.name; this.same = new.target === this.constructor; } }
class TargetHeir extends Target { }
function Plain() { } Plain.prototype = { tag: "plain" };
say("new.target", () => { log.length = 0; const a = make0(Target), b = make0(TargetHeir); return [a.t, a.same, b.t, b.same, take()]; });
say("construct with another target", () => { log.length = 0; const o = Reflect.construct(D, [1, 2], Plain); return [o.tag, o.x, o.y, o instanceof D, take()]; });
say("construct a base with a derived target", () => { log.length = 0; const o = Reflect.construct(B, [1], E); return [o.x, o instanceof E, Object.keys(o), take()]; });
say("construct with a target that is no constructor", () => Reflect.construct(D, [1, 2], () => 1));
// It cannot be called as a function.
say("called", () => D(1, 2));
say("called through call", () => D.call({}, 1, 2));
say("called through a value", () => { const f = [D][0]; return f(1); });
// The prototype of the class object is read when it constructs.
class Moves extends B { constructor(x) { super(x); this.m = 1; } }
class Elsewhere { constructor(x) { this.elsewhere = x; } }
say("the parent changed", () => { log.length = 0; const a = make1(Moves, 1); Object.setPrototypeOf(Moves, Elsewhere); const b = make1(Moves, 2); Object.setPrototypeOf(Moves, E); const c = make1(Moves, 3); Object.setPrototypeOf(Moves, null); let d; try { make1(Moves, 4); } catch (e) { d = e.constructor.name; } Object.setPrototypeOf(Moves, B); const f = make1(Moves, 5); log.length = 0; return [Object.keys(a), Object.keys(b), Object.keys(c), d, Object.keys(f), b instanceof Moves, b instanceof Elsewhere]; });
say("the prototype's parent changed", () => { class Q extends B { constructor() { super(1); } } Object.setPrototypeOf(Q.prototype, { from: "elsewhere" }); const o = make0(Q); log.length = 0; return [o.from, o.x, o instanceof B, o instanceof Q]; });
// Exceptions thrown along the way, with handlers at the site and inside.
class Throws { constructor(x) { if (x) throw new RangeError("base"); this.ok = 1; } }
class OverThrows extends Throws { constructor(x) { log.push("in"); super(x); log.push("not reached " + x); } }
class Catches extends Throws { constructor(x) { try { super(x); } catch (e) { log.push("caught " + e.message); super(0); } } }
class ThrowsBefore extends B { constructor() { throw new SyntaxError("before"); } }
class ThrowsAfter extends B { constructor() { super(1); throw new EvalError("after"); } }
say("the base throws", () => make1(OverThrows, 1)); say("what ran", take);
say("the base throws under a handler at the site", () => { let r; try { r = make1(OverThrows, 1); } catch (e) { r = e.message; } finally { log.push("finally"); } return [r, take()]; });
say("caught within, and super again", () => [make1(Catches, 1).ok, take()]);
say("throws before", () => make0(ThrowsBefore)); say("throws after", () => make0(ThrowsAfter)); log.length = 0;
// The stack runs out as anywhere.
class Deep extends B { constructor(n) { super(n); if (n) this.next = make1(Deep, n - 1); } }
say("a hundred deep", () => { let o = make1(Deep, 100), n = 0; while (o.next) { o = o.next; n++; } log.length = 0; return n; });
say("too deep", () => { try { return make1(Deep, 1000000); } finally { log.length = 0; } });
// Values that are not constructors at all, at the same sites.
for (const [n, v] of [["an arrow", () => 1], ["a method", { m() { } }.m], ["an async function", async function () { }], ["a generator", function* () { }], ["undefined", undefined], ["a number", 1], ["an object", {}], ["Symbol", Symbol], ["Math.max", Math.max]])
    say("new of " + n, () => make1(v, 1));
say("the sites still serve the others", () => { const r = [make1(B, 1).x, make1(F, 2).x, make2(D, 3, 4).y, make3(Array, 1, 2, 3).length, make1(Number, 5) + 1, typeof make0(Date), make1(String, "s").length]; log.length = 0; return r; });
