"use strict";
function new0(F) { return new F(); }
function new1(F, a) { return new F(a); }
function new3(F, a, b, c) { return new F(a, b, c); }
function new9(F) { return new F(1, 2, 3, 4, 5, 6, 7, 8, 9); }
function newSpread(F, list) { return new F(...list); }
function P0() { this.n = arguments.length; }
function P2(a, b) { this.a = a; this.b = b; }
function P5(a, b, c, d, e) { this.all = [a, b, c, d, e].map(String).join(); }
function P10(a, b, c, d, e, f, g, h, i, j) { this.all = [a, b, c, d, e, f, g, h, i, j].map(String).join(); }
function Rest(...r) { this.r = r.join(); }
function ReturnsObject(a) { this.own = 1; return a === 1 ? { other: 1 } : a === 2 ? [2] : a === 3 ? function () {} : a; }
function ReadsNewTarget(a) { this.t = new.target === ReadsNewTarget; this.u = new.target === undefined; }
function WithProperty(a) { this.a = a; } WithProperty.extra = 1;
function WithPrototype(a) { this.a = a; } WithPrototype.prototype = { marker: "replaced" };
function PrimitivePrototype(a) { this.a = a; } PrimitivePrototype.prototype = 3;
function Throws(a) { this.a = a; throw new RangeError("from " + a); }
function Sloppyish(a) { return this === undefined ? "no this" : (this.a = a, undefined); }
function makeCapturing(v) { return function Capturing(a) { this.sum = v + (a | 0); }; }
class Base { constructor(a) { this.a = a; } }
class Fields { x = 1; y = 2; }
class Derived extends Base { constructor(a, b) { super(a); this.b = b; } }
class DerivedDefault extends Base {}
class DerivedFromNative extends Map {}
class TakesNewTarget { constructor() { this.t = new.target === TakesNewTarget; } }
class ReturnsFromBase { constructor(a) { this.own = 1; if (a === 1) return { other: 1 }; if (a === 2) return 5; } }
const arrow = () => {}; const method = { m() {} }.m; async function asynchronous() {} function* generator() {}
module.exports = { new0, new1, new3, new9, newSpread, callees: { P0, P2, P5, P10, Rest, ReturnsObject, ReadsNewTarget, WithProperty, WithPrototype, PrimitivePrototype, Throws, Sloppyish, Capturing1: makeCapturing(1), Capturing2: makeCapturing(2),
  Base, Fields, Derived, DerivedDefault, DerivedFromNative, TakesNewTarget, ReturnsFromBase, arrow, method, asynchronous, generator, boundP2: P2.bind(null, "b"), boundBase: Base.bind(null, "b"), proxy: new Proxy(P2, {}),
  trap: new Proxy(P2, { construct(t, a) { return { trapped: a.length }; } }), Object, Array, Map, Date, Error, Promise, Symbol, nothing: undefined, nil: null, number: 5, plain: {} } };
