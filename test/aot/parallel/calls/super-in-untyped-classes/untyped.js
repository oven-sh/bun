"use strict";
var log = [];
class Base { constructor(a, b) { this.a = a; this.b = b; this.target = new.target.name; } who() { return "Base"; } }
function Fn(a) { this.fn = a; } Fn.prototype.who = function () { return "Fn"; };
function FnReturns(a) { this.own = 1; if (a === 1) return { replaced: true }; if (a === 2) return 5; }
function FnRest(...r) { this.r = r.join(); }
function FnStatics(a) { this.s = a; } FnStatics.extra = 1; FnStatics.prototype = { who() { return "FnStatics"; } };
function FnThrows(a) { throw new RangeError("from parent " + a); }
class Plain { constructor(a, b) { this.p = a; this.q = b; } who() { return "Plain"; } }
class PlainFields { x = 1; y = 2; }
class FromPlain extends Plain { constructor(a, b) { super(a, b); this.c = 3; } }
class FromPlainFewer extends Plain { constructor() { super(); } }
class FromPlainDefault extends Plain {}
class FromPlainFields extends PlainFields { z = this.x + this.y; }
class ThirdFromPlain extends FromPlain { constructor() { super(7, 8); this.d = 4; } }
class FromBase extends Base { constructor(a, b) { super(a, b); this.c = 3; } }
class FromBaseFewer extends Base { constructor() { super(1); } }
class FromBaseMore extends Base { constructor() { super(1, 2, 3, 4, 5, 6, 7, 8, 9, 10); } }
class FromBaseSpread extends Base { constructor(...r) { super(...r); } }
class FromBaseDefault extends Base {}
class FromFn extends Fn { constructor(a) { super(a); this.x = 1; } }
class FromFnReturns extends FnReturns { constructor(a) { super(a); this.after = Object.keys(this).join(); } }
class FromFnRest extends FnRest { constructor() { super(1, 2, 3); } }
class FromFnStatics extends FnStatics { constructor(a) { super(a); } }
class FromFnThrows extends FnThrows { constructor(a) { try { super(a); } catch (e) { log.push("caught " + e.message); super(a + 1); } } }
class Third extends FromBase { constructor() { super(7, 8); this.d = 4; } }
class Fourth extends Third { constructor() { super(); this.e = 5; } }
class FromError extends Error { constructor(m) { super(m); this.code = "E"; } }
class FromMap extends Map { constructor() { super([[1, 2]]); } }
class FromArray extends Array { constructor(n) { super(n); } }
class FromExpression extends (log.push("evaluated"), Base) { constructor() { super(0, 0); } }
class FromNull extends null { constructor() { return Object.create(FromNull.prototype); } }
class FromNullSuper extends null { constructor() { super(); } }
class Fields extends Base { f = this.a + 1; constructor() { log.push("before"); super(10, 20); log.push("after " + this.f); } }
class ThisBeforeSuper extends Base { constructor() { this.x = 1; super(); } }
class NoSuper extends Base { constructor() {} }
class TwiceSuper extends Base { constructor() { super(1, 2); super(3, 4); } }
class ReturnsObject extends Base { constructor() { super(1, 2); return { other: 1 }; } }
class ArgumentsEvaluatedFirst extends Base { constructor() { super(log.push("arg1"), log.push("arg2")); } }
class Swapped extends Plain { constructor() { super(1, 2); } }
function describe(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + (Object.getPrototypeOf(o) === null ? "null" : Object.getPrototypeOf(o).constructor.name) + (typeof o.who === "function" ? " " + o.who() : ""); }
function attempt(f) { try { return describe(f()); } catch (e) { return "threw " + e.constructor.name + (String(e.message).startsWith("from") ? " " + e.message : ""); } }
function all() {
  const out = [];
  for (const C of [FromPlain, FromPlainFewer, FromPlainDefault, FromPlainFields, ThirdFromPlain, FromBase, FromBaseFewer, FromBaseMore, FromBaseSpread, FromBaseDefault, FromFn, FromFnReturns, FromFnRest, FromFnStatics, FromFnThrows, Third, Fourth, FromExpression, FromNull, FromNullSuper, Fields, ThisBeforeSuper, NoSuper, TwiceSuper,
    ReturnsObject, ArgumentsEvaluatedFirst]) out.push(C.name + ": " + attempt(() => new C(1, 2)) + " | " + attempt(() => new C(2)) + " | " + attempt(() => new C()));
  out.push(attempt(() => { const e = new FromError("m"); return { m: e.message, c: e.code, i: e instanceof Error, s: typeof e.stack }; }), attempt(() => ({ n: new FromMap().get(1), i: new FromMap() instanceof Map })), attempt(() => ({ l: new FromArray(3).length, a: Array.isArray(new FromArray(1)) })));
  return out;
}
// The parent is exchanged between constructions through one and the same `super(..)`.
function swapped() {
  const out = [attempt(() => new Swapped())];
  Object.setPrototypeOf(Swapped, Fn); out.push(attempt(() => new Swapped()));
  Object.setPrototypeOf(Swapped, Map); out.push(attempt(() => typeof new Swapped().size));
  Object.setPrototypeOf(Swapped, function () { return { fromAnonymous: 1 }; }); out.push(attempt(() => new Swapped()));
  Object.setPrototypeOf(Swapped, () => {}); out.push(attempt(() => new Swapped()));
  Object.setPrototypeOf(Swapped, null); out.push(attempt(() => new Swapped()));
  Object.setPrototypeOf(Swapped, new Proxy(Base, {})); out.push(attempt(() => new Swapped()));
  Object.setPrototypeOf(Swapped, Base.bind(null, "bound")); out.push(attempt(() => new Swapped()));
  Object.setPrototypeOf(Swapped, Base); out.push(attempt(() => new Swapped()));
  Object.setPrototypeOf(Swapped, Plain); out.push(attempt(() => new Swapped()));
  return out;
}
// new.target that is not the class: Reflect.construct, with closures of the program and with other functions.
function targets() {
  return [attempt(() => Reflect.construct(FromPlain, [1, 2], Fn)), attempt(() => Reflect.construct(FromPlain, [1, 2], ThirdFromPlain)), attempt(() => Reflect.construct(FromPlain, [1, 2], Object)), attempt(() => Reflect.construct(FromPlain, [1, 2], new Proxy(Fn, {}))), attempt(() => Reflect.construct(FromPlain, [1, 2], Fn.bind(null))),
    attempt(() => Reflect.construct(FromBase, [1, 2], Fn)), attempt(() => Reflect.construct(FromBase, [1, 2], Third)), attempt(() => Reflect.construct(FromBase, [1, 2], Object)), attempt(() => Reflect.construct(FromBase, [1, 2], function () {}.bind(null))),
    attempt(() => Reflect.construct(FromFn, [1], class { who() { return "anonymous"; } })), attempt(() => Reflect.construct(FromBase, [1, 2], new Proxy(Fn, {})))];
}
module.exports = { log, all, swapped, targets };
