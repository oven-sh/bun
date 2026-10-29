// Functions that are frozen: what they answer afterwards, whether anything was read off them before or not. A function gets its `prototype` object at the first read, also where that read comes after the freeze.
"use strict";
const say = (...values) => console.log(...values);
const describe = (object, key) => { const d = Object.getOwnPropertyDescriptor(object, key); return d === undefined ? "none" : [typeof d.value, d.writable, d.enumerable, d.configurable, typeof d.get].join(); };
const attempt = run => { try { return run(); } catch (e) { return e.name; } };
function report(label, f) {
  say(label, Object.isFrozen(f), Object.isSealed(f), Object.isExtensible(f), Reflect.ownKeys(f).map(String).join());
  for (const key of ["length", "name", "prototype", "extra", "tag"]) say(" ", key, describe(f, key));
  say("  stores", attempt(() => { f.extra = 2; return "stored"; }), attempt(() => { f.other = 1; return "stored"; }), attempt(() => { f.name = "x"; return "stored"; }), attempt(() => { f.prototype = {}; return "stored"; }), attempt(() => { f[0] = 1; return "stored"; }));
  say("  deletes", attempt(() => delete f.extra), attempt(() => delete f.name), attempt(() => delete f.missing), attempt(() => Object.defineProperty(f, "name", { value: "y" }) === f), attempt(() => Object.setPrototypeOf(f, null) === f), attempt(() => Object.setPrototypeOf(f, Object.getPrototypeOf(f)) === f));
}
function plain(a, b) { return a + b; }
report("never touched", Object.freeze(plain));
say(plain(1, 2), plain.name, plain.length, typeof plain.prototype, plain.prototype === plain.prototype, plain.prototype.constructor === plain, new plain(1, 2) instanceof plain, Object.getPrototypeOf(new plain()) === plain.prototype, Object.isFrozen(plain), Object.isFrozen(plain.prototype));
function touched() {}
const before = touched.prototype; touched.extra = 1; touched[Symbol.for("tag")] = 2;
report("touched", Object.freeze(touched));
say(touched.prototype === before, touched.extra, touched[Symbol.for("tag")], describe(touched, Symbol.for("tag")));
const arrow = Object.freeze(() => 1); report("arrow", arrow); say(arrow(), "prototype" in arrow);
const method = Object.freeze({ m() { return this; } }.m); report("method", method);
const asyncFunction = Object.freeze(async function later() {}); report("async", asyncFunction);
const generator = Object.freeze(function* steps() { yield 1; }); report("generator", generator); say(typeof generator.prototype, [...generator()].join(), Object.getPrototypeOf(generator()) === generator.prototype);
class Base { static tag = 1; static make() { return new this(); } } report("class", Object.freeze(Base)); say(Base.make() instanceof Base, Base.tag, attempt(() => { Base.tag = 2; return "stored"; }));
class Derived extends Base {} say(new Derived() instanceof Base, Derived.make() instanceof Derived, Derived.tag);
const bound = Object.freeze(plain.bind(null, 1)); report("bound", bound); say(bound(2));
const withAccessor = function () {}; Object.defineProperty(withAccessor, "tag", { get() { return 7; }, configurable: true }); report("accessor", Object.freeze(withAccessor)); say(withAccessor.tag);
const indexed = function () {}; indexed[0] = "zero"; indexed[5] = "five"; Object.freeze(indexed); say(Object.isFrozen(indexed), describe(indexed, 0), describe(indexed, "5"), attempt(() => { indexed[0] = 1; return "stored"; }), attempt(() => { indexed[1] = 1; return "stored"; }), Reflect.ownKeys(indexed).join());
const renamed = function original() {}; Object.defineProperty(renamed, "name", { value: "renamed" }); Object.freeze(renamed); say(renamed.name, describe(renamed, "name"), renamed.bind().name);
say(Object.freeze(plain) === plain, Object.isFrozen(Object.freeze(Object.freeze(function () {}))));
const made = []; for (let i = 0; i < 2000; i++) { const f = function (x) { return x + i; }; f.index = i; made.push(Object.freeze(f)); }
say(made.every((f, i) => Object.isFrozen(f) && f.index === i && f(1) === i + 1), made[7].prototype.constructor === made[7], made[8].prototype !== made[7].prototype, attempt(() => { made[9].index = 0; return "stored"; }));
const sealed = Object.seal(function s() {}); say(Object.isSealed(sealed), Object.isFrozen(sealed), describe(sealed, "prototype"), describe(sealed, "name"));
const closedToMore = Object.preventExtensions(function p() {}); say(Object.isExtensible(closedToMore), Object.isFrozen(closedToMore), describe(closedToMore, "prototype"));
const sloppy = new Function("f", "f.extra = 5; f.other = 6; delete f.name; return [f.extra, f.other, f.name].join()"); say(sloppy(touched), sloppy(plain));
