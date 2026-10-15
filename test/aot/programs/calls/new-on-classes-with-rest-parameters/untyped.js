function say(n, f) { let r; try { r = JSON.stringify(f()); if (r === undefined) r = "undefined"; } catch (e) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
const log = [];
function take() { return log.splice(0).join(","); }
function note(x) { log.push(String(x)); return x; }
class B { constructor(x) { log.push("B " + new.target.name); this.x = x; } }
class D extends B { constructor(x, y) { super(x); this.y = y; } }
class Sees extends B { constructor(a, b) { super(a); this.n = arguments.length; this.list = Array.prototype.slice.call(arguments); this.b = b; } }
class I extends D { }
class J extends I { }
class K extends J { }
class ISees extends Sees { }
class JSees extends ISees { }
class Forwards extends D { constructor(...args) { super(...args); this.f = 1; } }
class ForwardsSees extends Sees { constructor(...args) { super(...args); } }
class ForwardsTwice extends Forwards { constructor(...more) { super(...more); this.g = 2; } }
say("no constructor of its own", () => { const o = new I(1, 2); return [o.x, o.y, Object.keys(o), o instanceof I, Object.getPrototypeOf(o) === I.prototype, take()]; });
say("two of them", () => { const o = new J(1, 2); return [o.x, o.y, Object.getPrototypeOf(o) === J.prototype, take()]; });
say("three of them", () => { const o = new K(1, 2); return [o.x, o.y, Object.getPrototypeOf(o) === K.prototype, take()]; });
say("a forwarder", () => { const o = new Forwards(1, 2); return [o.x, o.y, o.f, Object.keys(o), take()]; });
say("a forwarder over a forwarder", () => { const o = new ForwardsTwice(1, 2); return [o.x, o.y, o.f, o.g, Object.keys(o), take()]; });
say("in loops", () => { let t = 0; for (let i = 0; i < 3000; i++) { t += new I(i, 1).x + new J(i, 2).y + new Forwards(i, 3).y + new ForwardsTwice(i, 4).g + new ISees(i, 5, 6).n; } log.length = 0; return t; });
// How many were passed is seen at the far end.
say("ISees, 0 to 12", () => { const all = [new ISees(), new ISees(1), new ISees(1, 2), new ISees(1, 2, 3), new ISees(1, 2, 3, 4), new ISees(1, 2, 3, 4, 5), new ISees(1, 2, 3, 4, 5, 6), new ISees(1, 2, 3, 4, 5, 6, 7, 8), new ISees(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)]; log.length = 0; return all.map(o => [o.n, o.list, o.b]); });
say("JSees, 0 to 12", () => { const all = [new JSees(), new JSees(1), new JSees(1, 2), new JSees(1, 2, 3), new JSees(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)]; log.length = 0; return all.map(o => [o.n, o.list]); });
say("ForwardsSees, 0 to 12", () => { const all = [new ForwardsSees(), new ForwardsSees(1), new ForwardsSees(1, 2), new ForwardsSees(1, 2, 3), new ForwardsSees(undefined), new ForwardsSees(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)]; log.length = 0; return all.map(o => [o.n, o.list]); });
say("Sees itself", () => { const all = [new Sees(), new Sees(1), new Sees(1, 2, 3), new Sees(1, 2, 3, 4, 5, 6, 7, 8, 9)]; log.length = 0; return all.map(o => [o.n, o.list, o.b]); });
// `arguments` in class code is not mapped to the parameters.
class Unmapped extends B { constructor(a) { super(a); a = "changed"; this.first = arguments[0]; arguments[0] = "stored"; this.a = a; this.callee = (() => { try { return typeof arguments.callee; } catch (e) { return e.constructor.name; } })(); } }
say("arguments and parameters", () => { const o = new Unmapped("given"); log.length = 0; return [o.first, o.a, o.callee]; });
// The rest: a new true array each time.
class Keeps { constructor(a, ...rest) { this.a = a; this.rest = rest; } }
class KeepsDerived extends B { constructor(a, ...rest) { super(a); this.rest = rest; } }
class KeepsAll extends B { constructor(...all) { super(all.length); this.all = all; } }
say("the rest of a base class", () => [new Keeps(), new Keeps(1), new Keeps(1, 2), new Keeps(1, 2, 3, 4, 5, 6, 7, 8, 9)]);
say("the rest of a derived class", () => { const r = [new KeepsDerived(), new KeepsDerived(1), new KeepsDerived(1, 2), new KeepsDerived(1, 2, 3, 4, 5, 6, 7, 8, 9)]; log.length = 0; return r; });
say("a true array", () => { const r = new KeepsAll(1, 2).all; log.length = 0; return [Array.isArray(r), Object.getPrototypeOf(r) === Array.prototype, r.length, Object.keys(r), r.constructor === Array, Object.isExtensible(r)]; });
say("a new one each time", () => { function make() { return new KeepsAll(1, 2); } const a = make(), b = make(); a.all.push(3); a.all[0] = "stored"; const c = make(); log.length = 0; return [a.all === b.all, a.all, b.all, c.all]; });
say("none passed: empty, not absent", () => { const o = new KeepsAll(); log.length = 0; return [o.all, o.x]; });
// The list is used for more than the spread.
let kept;
class PushesFirst extends Sees { constructor(...args) { args.push("pushed"); super(...args); } }
class StoresFirst extends Sees { constructor(...args) { args[0] = "stored"; args.length = 2; super(...args); } }
class UsesAfter extends Sees { constructor(...args) { super(...args); this.count = args.length; this.same = args; } }
class Escapes extends Sees { constructor(...args) { kept = args; super(...args); } }
class SpreadsTwice extends Sees { constructor(...args) { super(...args, ...args); } }
class Prefix extends Sees { constructor(...args) { super("first", ...args); } }
class Suffix extends Sees { constructor(...args) { super(...args, "last"); } }
class PassesWhole extends Sees { constructor(...args) { super(args); } }
class ChangedByArgument extends Sees { constructor(...args) { super(...args, (args.push("late"), "end")); } }
class ChangedBefore extends Sees { constructor(...args) { super((args.push("early"), "start"), ...args); } }
for (const [n, f] of [["pushes first", () => new PushesFirst(1, 2)], ["stores first", () => new StoresFirst(1, 2, 3)], ["uses it after", () => new UsesAfter(1, 2)], ["lets it out", () => [new Escapes(1, 2), kept]], ["spreads it twice", () => new SpreadsTwice(1, 2)], ["something ahead", () => new Prefix(1, 2)], ["something behind", () => new Suffix(1, 2)], ["passes it whole", () => new PassesWhole(1, 2)], ["changed by a later argument", () => new ChangedByArgument(1)], ["changed by an earlier argument", () => new ChangedBefore(1)]])
    say(n, () => { const r = f(); log.length = 0; return r; });
// A spread uses the iterator of its operand.
class Spreads extends Sees { constructor(what) { super(...what); } }
class SpreadsLiteral extends Sees { constructor(a, b) { super(...[a, b]); } }
class SpreadsLiteralWithHole extends Sees { constructor(a) { super(...[a, , a]); } }
class SpreadsEmpty extends Sees { constructor() { super(...[]); } }
function* yields() { note("y1"); yield 1; note("y2"); yield 2; }
say("a literal", () => { const o = new SpreadsLiteral(1, 2); log.length = 0; return [o.n, o.list]; });
say("a literal with a hole", () => { const o = new SpreadsLiteralWithHole(1); log.length = 0; return [o.n, o.list, 1 in o.list]; });
say("an empty literal", () => { const o = new SpreadsEmpty(); log.length = 0; return [o.n, o.list]; });
// The arguments after a spread of a literal are pushed to the array that the spread has produced.
class BehindLiteral extends Sees { constructor(a, b) { super(...[a, b], "last"); } }
class TwoBehindLiteral extends Sees { constructor(a, b) { super(...[a, b], "l1", "l2"); } }
class BehindTwoLiterals extends Sees { constructor(a, b) { super(...[a], ...[b], "last"); } }
class AroundLiteral extends Sees { constructor(a, b) { super("first", ...[a, b], "last"); } }
class BehindEmptyLiteral extends Sees { constructor(a, b) { super(...[], a, b); } }
class BehindLiteralEvaluated extends Sees { constructor(a) { super(...[note(a)], note("behind")); } }
class BehindRestTwice extends Sees { constructor(...args) { super(...args, "mid", ...args, "last"); } }
for (const [n, f] of [["one", () => new BehindLiteral(1, 2)], ["two", () => new TwoBehindLiteral(1, 2)], ["two literals", () => new BehindTwoLiterals(1, 2)], ["around", () => new AroundLiteral(1, 2)], ["an empty one", () => new BehindEmptyLiteral(1, 2)], ["evaluated", () => new BehindLiteralEvaluated(1)], ["the rest twice", () => new BehindRestTwice(1, 2)]])
    say("behind a literal: " + n, () => { log.length = 0; const o = f(); return [o.n, o.list, take()]; });
say("a string", () => { const o = new Spreads("ab"); log.length = 0; return o.list; });
say("a set", () => { const o = new Spreads(new Set([3, 4])); log.length = 0; return o.list; });
say("a generator, before the parent", () => { log.length = 0; const o = new Spreads(yields()); return [o.list, take()]; });
say("an array with an iterator of its own", () => { const a = [1, 2]; a[Symbol.iterator] = function* () { yield "own"; }; const o = new Spreads(a); log.length = 0; return o.list; });
say("an heir of Array with another iterator", () => { class A extends Array { *[Symbol.iterator]() { yield "heir"; } } const o = new Spreads(A.of(1, 2)); log.length = 0; return o.list; });
say("an array with a getter", () => { const a = [1, 2, 3]; Object.defineProperty(a, 1, { get() { note("got"); return "g"; } }); log.length = 0; const o = new Spreads(a); return [o.list, take()]; });
for (const [n, v] of [["undefined", undefined], ["null", null], ["a number", 1], ["an object", {}]]) { log.length = 0; say("spread of " + n, () => new Spreads(v)); say("the parent was entered", () => take()); }
class Order extends Sees { constructor(...args) { super(note("a"), ...(note("b"), args), note("c"), ...(note("d"), [note("e")])); } }
say("from the left", () => { log.length = 0; const o = new Order(1, 2); return [o.list, take()]; });
// new.target, fields, the `extends` expression.
class Target extends B { constructor(...a) { super(...a); this.t = new.target.name; } }
class TargetHeir extends Target { }
class WithFields extends D { f = log.push("field") && this.y; }
class OverFields extends WithFields { g = this.f + 1; }
class IError extends Error { } class JError extends IError { }
class IArray extends Array { } class IMap extends Map { } class IPromise extends Promise { }
function F(x, y) { this.x = x; this.n = arguments.length; } class IF extends F { }
class INull extends null { }
say("new.target", () => { const r = [new Target(1).t, new TargetHeir(1).t]; return [r, take()]; });
say("fields", () => { log.length = 0; const o = new WithFields(1, 2), p = new OverFields(3, 4); return [o.f, Object.keys(o), p.f, p.g, Object.keys(p), take()]; });
say("over Error", () => { const e = new JError("m", { cause: 5 }); return [e.message, e.cause, e instanceof JError, e instanceof Error, Object.prototype.toString.call(e)]; });
say("over Array", () => [new IArray(3).length, new IArray(1, 2).length, new IArray().length, new IArray("3").length, new IArray(1, 2) instanceof IArray]);
say("over Array, a length that cannot be", () => new IArray(-1));
say("over Map and Promise", () => [new IMap([[1, 2]]).get(1), new IMap().size, new IPromise(() => 1) instanceof IPromise]);
say("over Promise, nothing passed", () => new IPromise());
say("over a plain function", () => { const o = new IF(1, 2, 3); return [o.x, o.n, o instanceof F, o instanceof IF]; });
say("over null", () => new INull());
// The prototype of the class object is read when it constructs; the other parent sees the arguments.
class Moves extends D { }
class Elsewhere { constructor() { this.saw = Array.prototype.slice.call(arguments); } }
say("the parent changed", () => { function make() { return new Moves(1, 2, 3); } const a = make(); Object.setPrototypeOf(Moves, Elsewhere); const b = make(); Object.setPrototypeOf(Moves, Sees); const c = make(); Object.setPrototypeOf(Moves, D); const d = make(); log.length = 0; return [a, b, c, d]; });
say("the grandparent changed", () => { class P extends B { constructor(x) { super(x); this.p = 1; } } class Q extends P { } function make() { return new Q(7, 8); } const a = make(); Object.setPrototypeOf(P, Elsewhere); const b = make(); log.length = 0; return [a, b]; });
// Throws and handlers.
class Throws { constructor(x) { if (x) throw new RangeError("base " + x); this.ok = 1; } }
class IThrows extends Throws { } class FThrows extends Throws { constructor(...a) { log.push("in"); super(...a); log.push("out"); } }
say("the parent throws", () => new IThrows(1));
say("under a handler", () => { let r = []; for (const x of [0, 1, 0, 2]) { try { r.push(new IThrows(x).ok); } catch (e) { r.push(e.message); } finally { r.push("f"); } } return r; });
say("a forwarder under a handler", () => { log.length = 0; let r; try { r = new FThrows(3); } catch (e) { r = e.message; } return [r, take()]; });
say("called", () => I(1, 2));
// The frames of a trace: a constructor that is not written has one too.
function framesOf(e) { return String(e.stack).split("\n").map(l => /(k_[a-z]+)/.exec(l)).filter(Boolean).map(m => m[1]).join(); }
class k_base { constructor(x) { if (x === 1) this.e = new Error("made"); if (x === 2) throw new Error("thrown"); } }
class k_mid extends k_base { constructor(x) { super(x); this.m = 1; } }
class k_imp extends k_mid { }
class k_imptwo extends k_imp { }
class k_fwd extends k_imptwo { constructor(...a) { super(...a); this.f = 1; } }
function k_site(x) { const o = new k_fwd(x); return o; }
function k_siteimp(x) { const o = new k_imp(x); return o; }
say("frames, an error made at the root", () => [framesOf(k_site(1).e), framesOf(k_siteimp(1).e)]);
say("frames, an error thrown at the root", () => { const r = []; for (const f of [k_site, k_siteimp]) { try { f(2); } catch (e) { r.push(framesOf(e)); } } return r; });
say("frames, in a loop", () => { let r; for (let i = 0; i < 300; i++) r = framesOf(k_site(1).e); return r; });
class Deep extends D { } class Chain extends Deep { constructor(n) { super(n, 0); if (n) this.next = new Chain(n - 1); } }
say("a hundred deep", () => { let o = new Chain(100), n = 0; while (o.next) { o = o.next; n++; } log.length = 0; return n; });
say("too deep", () => { try { return new Chain(1000000); } finally { log.length = 0; } });
