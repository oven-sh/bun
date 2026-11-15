"use strict";
const attempt = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const hide = (v) => [v][JSON.parse("0")];
const show = (o) => [Reflect.ownKeys(o).map(String).join(), JSON.stringify(o), Object.getPrototypeOf(o) === null].join(" | ");
function proto(i) { const r = Object.create(null); r.__proto__ = i; r.a = 1; return r; }
console.log("__proto__ a number", show(proto(5)), proto(5).__proto__, Object.keys(proto(6)).length);
function protoObject() { const r = Object.create(null); r.__proto__ = { up: 1 }; r.a = 1; return r; }
console.log("__proto__ an object", show(protoObject()), protoObject().up, "up" in protoObject());
function protoNull() { const r = Object.create(null); r.a = 1; r.__proto__ = null; return r; }
console.log("__proto__ null", show(protoNull()));
function names(i) { const r = Object.create(null); r.constructor = i; r.toString = () => "mine"; r.valueOf = 3; r.hasOwnProperty = 4; r.length = 5; r.then = 6; r.prototype = 7; r.name = 8; return r; }
console.log("names of Object.prototype", show(names(1)), "" + names(1), attempt(() => names(1) + 1));
function inDeclaration() { const r = Object.create(null); r.first = 1; function later() { r.second = 2; } if (hide(true)) later(); return r; }
console.log("a store in a declaration", show(inDeclaration()));
function neverRun() { const r = Object.create(null); r.first = 1; function later() { r.second = 2; } hide(later); return r; }
console.log("a store that never runs", show(neverRun()), "second" in neverRun(), neverRun().second);
function twice() { const r = Object.create(null); r.a = 1; r.a = 2; r.b = r.a; return r; }
console.log("one name twice", show(twice()));
function compound() { const r = Object.create(null); r.a = 1; r.a += 2; r.b ??= 4; r.c ||= 5; r.a++; return r; }
console.log("compound", show(compound()));
function patterns(o, l) { const r = Object.create(null); r.z = 0; ({ x: r.x, y: r.y = 9 } = o); [r.p, ...r.q] = l; for (r.k in { last: 1 }); for (r.v of [7]); return r; }
console.log("patterns", show(patterns({ x: 1 }, [1, 2, 3])));
function reassigned(c) { let r = Object.create(null); r.a = 1; if (c) r = { b: 2 }; r.c = 3; return r; }
console.log("reassigned", JSON.stringify(reassigned(hide(true))), show(reassigned(hide(false))));
function symbols() { const r = Object.create(null); r.a = 1; r[Symbol.toPrimitive] = () => 42; return r; }
console.log("a symbol beside", +symbols(), Reflect.ownKeys(symbols()).length);
function numbers() { const r = Object.create(null); r.a = 1; r[0] = "zero"; r["1"] = "one"; return r; }
console.log("indexes beside", show(numbers()));
class Outer { static #s = 1; #i = 2; static make() { const r = Object.create(null); r.a = Outer.#s; return r; } also() { const r = Object.create(null); r.i = this.#i; r.self = this; return r; } }
console.log("in a class", show(Outer.make()), new Outer().also().i);
function withGetter() { const r = Object.create(null); r.a = 1; r.__defineGetter__; return attempt(() => r.__defineGetter__("b", () => 2)); }
console.log("no __defineGetter__", withGetter());
function sealed() { const r = Object.create(null); r.a = 1; Object.seal(r); return attempt(() => { r.b = 2; return "stored"; }) + " " + show(r); }
console.log("sealed between", sealed());
function unicode() { const r = Object.create(null); r.é = 1; r.ünï = 2; r.$ = 3; r._ = 4; r.\u{1d4d0} = 5; return r; }
console.log("names beyond ASCII", show(unicode()));
