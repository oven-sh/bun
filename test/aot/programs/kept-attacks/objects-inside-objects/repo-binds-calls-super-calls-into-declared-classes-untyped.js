// Objects inside objects: repo binds calls super calls into declared classes untyped. It prints what plain Bun prints.
function say(n, f) { let r; try { r = JSON.stringify(f()); if (r === undefined) r = "undefined"; } catch (e) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
const log = [];
class B { constructor(x) { log.push("B " + (new.target && new.target.name)); this.x = x; } who() { return "B"; } }
class P extends B { constructor(x, y) { log.push("P before " + new.target.name); super(x); log.push("P after"); this.y = y; } who() { return "P" + super.who(); } }
class Q extends P { constructor(x, y, z) { super(x, y); this.z = z; } who() { return "Q" + super.who(); } }
function take() { return log.splice(0).join(","); }
say("three levels", () => { const q = new Q(1, 2, 3); return [q.x, q.y, q.z, q.who(), q instanceof Q, q instanceof P, q instanceof B, Object.getPrototypeOf(q) === Q.prototype, Object.keys(q), take()]; });
say("two levels", () => { const p = new P(1, 2); return [p.x, p.y, p.who(), Object.getPrototypeOf(p) === P.prototype, take()]; });
say("in a loop", () => { let t = 0; for (let i = 0; i < 2000; i++) { const q = new Q(i, 1, 2); t += q.x + q.y + q.z; } log.length = 0; return t; });
say("construct, a target of the program", () => { const o = Reflect.construct(Q, [1, 2, 3], P); return [o.x, o.y, o.z, Object.getPrototypeOf(o) === P.prototype, o instanceof Q, take()]; });
say("construct, a plain function for target", () => { function F() {} F.prototype = { tag: "F" }; const o = Reflect.construct(Q, [1, 2, 3], F); return [o.tag, o.z, o instanceof Q, take()]; });
say("construct, a bound target", () => { const T = Q.bind(null); const o = Reflect.construct(Q, [1, 2, 3], T); return [o.z, Object.getPrototypeOf(o) === Object.prototype, Object.getPrototypeOf(o) === Q.prototype, take().length > 0]; });
say("construct, a proxy for target", () => { const seen = []; const T = new Proxy(Q, { get(t, k, r) { seen.push(String(k)); return Reflect.get(t, k, r); } }); const o = Reflect.construct(Q, [1, 2, 3], T); log.length = 0; return [o.z, o instanceof Q, seen]; });
say("construct, a target whose prototype is no object", () => { function F() {} F.prototype = 5; const o = Reflect.construct(Q, [1, 2, 3], F); log.length = 0; return [Object.getPrototypeOf(o) === Object.prototype, o.z]; });
// Another parent for the class object.
class B2 { constructor(x) { this.from = "B2"; this.x = x; } }
class P2 extends B2 { constructor(x) { super(x); this.p = 1; } }
class Q2 extends P2 { constructor(x) { super(x); this.q = 1; } }
class Other { constructor(x) { this.from = "Other"; this.other = x; } }
function make2() { const o = new Q2(7); return [o.from, o.x, o.other, o.p, o.q, o instanceof Q2, o instanceof P2, o instanceof B2, o instanceof Other]; }
say("before any change", make2);
say("the middle one gets another parent", () => { Object.setPrototypeOf(P2, Other); return make2(); });
say("and back", () => { Object.setPrototypeOf(P2, B2); return make2(); });
say("the last one gets another parent", () => { Object.setPrototypeOf(Q2, Other); return make2(); });
say("by __proto__", () => { Q2.__proto__ = P2; P2.__proto__ = Other; return make2(); });
say("a parent that is no constructor", () => { Object.setPrototypeOf(P2, { not: 1 }); return make2(); });
say("Function.prototype for a parent", () => { Object.setPrototypeOf(P2, Function.prototype); return make2(); });
say("null for a parent", () => { Object.setPrototypeOf(P2, null); return make2(); });
say("restored", () => { Object.setPrototypeOf(P2, B2); return make2(); });
say("the same parent again changes nothing", () => { Object.setPrototypeOf(P2, B2); return make2(); });
// A change in the middle of a construction.
class B3 { constructor() { this.b3 = 1; } }
class P3 extends B3 { constructor(swap) { if (swap) Object.setPrototypeOf(P3, Other); super(9); this.p3 = 1; } }
class Q3 extends P3 { constructor(swap) { super(swap); this.q3 = 1; } }
say("changed while it constructs", () => [Object.keys(new Q3(false)), Object.keys(new Q3(true)), Object.keys(new Q3(false))]);
// What constructors return.
class RB { constructor(k) { this.k = k; if (k === 1) return { replaced: "by RB" }; if (k === 2) return 5; if (k === 3) return undefined; if (k === 4) return null; } }
class RP extends RB { constructor(k, m) { super(k); this.m = m; if (m === 1) return { replaced: "by RP" }; if (m === 2) return undefined; if (m === 3) return; } }
class RQ extends RP { constructor(k, m) { super(k, m); this.last = 1; } }
for (const k of [0, 1, 2, 3, 4]) for (const m of [0, 1, 2, 3]) say("returns " + k + " " + m, () => { const o = new RQ(k, m); return [Object.keys(o), o.replaced, o instanceof RQ]; });
class RBad extends RB { constructor() { super(0); return 5; } }
class RBad2 extends RBad { constructor() { super(); this.after = 1; } }
say("a derived constructor returns a number", () => new RBad2());
class NoSuper extends RB { constructor() { } }
class NoSuper2 extends NoSuper { constructor() { super(); this.after = 1; } }
say("a parent that never calls super", () => new NoSuper2());
class Twice extends RB { constructor() { super(0); super(0); } }
class Twice2 extends Twice { constructor() { super(); } }
say("a parent that calls super twice", () => new Twice2());
class Early extends RB { constructor() { this.x = 1; super(0); } }
class Early2 extends Early { constructor() { super(); } }
say("this before super in the parent", () => new Early2());
// Throwing.
class TB { constructor(t) { if (t) throw new RangeError("from TB"); this.ok = 1; } }
class TP extends TB { constructor(t) { try { super(t); } catch (e) { log.push("caught in TP: " + e.message); throw e; } } }
class TQ extends TP { constructor(t) { let r = "none"; try { super(t); r = "made"; } catch (e) { r = "caught in TQ"; super(false); } this.r = r; } }
say("a parent throws", () => [new TQ(false).r, new TQ(true).r, take()]);
say("the names in the trace", () => { class XB { constructor() { throw new Error("x"); } } class XP extends XB { constructor() { super(); } } class XQ extends XP { constructor() { super(); } } try { new XQ(); } catch (e) { return String(e.stack).split("\n").map(l => (/^\s*at (?:new )?([\w$]+) /.exec(l) || /^([\w$]+)@/.exec(l) || [])[1]).filter(Boolean).slice(0, 3); } });
// No constructor written; arguments handed on; defaults, rest, spread.
class DB { constructor(...all) { this.all = all; } }
class DP extends DB { }
class DQ extends DP { extra = this.all.length; }
say("constructors that are not written", () => { const o = new DQ(1, 2, 3); return [o.all, o.extra, new DQ().all]; });
class AB { constructor(a, b = "default", ...rest) { this.got = [a, b, rest, arguments.length]; } }
class AP extends AB { constructor(...all) { super(...all); } }
class AQ extends AP { constructor(a, b, c, d) { super(a, b, c, d); } }
class AR extends AB { constructor(a) { super(a); } }
class AS extends AR { constructor(a) { super(a, "dropped"); } }
say("arguments", () => [new AQ(1).got, new AQ(1, 2, 3, 4).got, new AP().got, new AS(1).got]);
class Many extends AB { constructor() { super(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); } }
class Many2 extends Many { constructor() { super(); } }
say("more arguments than registers", () => new Many2().got);
// The `extends` expression is not a constant.
const mixin = Base => class extends Base { constructor(...a) { super(...a); this.mixed = 1; } };
class MQ extends mixin(mixin(B)) { constructor() { super(5); this.mq = 1; } }
say("mixins", () => { const o = new MQ(); log.length = 0; return [Object.keys(o), o instanceof B]; });
let chosen = B; class VQ extends chosen { constructor() { super(1); } } chosen = Other;
say("a variable that is stored to later", () => { const o = new VQ(); log.length = 0; return [Object.keys(o), o instanceof B]; });
class NullP extends null { constructor() { return Object.create(NullP.prototype); } }
class NullQ extends NullP { constructor() { super(); this.n = 1; } }
say("extends null at the root", () => { const o = new NullQ(); return [o.n, o instanceof NullP, o instanceof NullQ, Object.getPrototypeOf(NullP.prototype)]; });
function OldStyle(x) { this.old = x; } OldStyle.prototype.hi = function () { return "hi"; };
class OverOld extends OldStyle { constructor(x) { super(x); this.o1 = 1; } }
class OverOld2 extends OverOld { constructor(x) { super(x); this.o2 = 1; } }
say("a plain function at the root", () => { const o = new OverOld2(3); return [Object.keys(o), o.hi(), o instanceof OldStyle]; });
class EP extends Error { constructor(m) { super(m); this.ep = 1; } }
class EQ extends EP { constructor(m) { super(m); this.eq = 1; } }
say("the engine's class at the root", () => { const o = new EQ("msg"); return [o.message, o.ep, o.eq, o instanceof Error, Object.prototype.toString.call(o), Object.getPrototypeOf(o) === EQ.prototype]; });
class AP2 extends Array { constructor(...a) { super(...a); } }
class AQ2 extends AP2 { constructor(...a) { super(...a); } }
say("Array at the root", () => { const o = new AQ2(1, 2, 3); return [o.length, Array.isArray(o), o.map(x => x * 2) instanceof AQ2]; });
// A class that is evaluated more than once.
function family() { class FB2 { constructor() { this.f = 1; } } class FP2 extends FB2 { constructor() { super(); this.g = 1; } } class FQ2 extends FP2 { constructor() { super(); this.h = 1; } } return [FB2, FP2, FQ2]; }
say("evaluated twice", () => { const a = family(), b = family(); Object.setPrototypeOf(a[1], Other); return [Object.keys(new a[2]()), Object.keys(new b[2]()), new b[2]() instanceof a[0], new b[2]() instanceof b[0]]; });
