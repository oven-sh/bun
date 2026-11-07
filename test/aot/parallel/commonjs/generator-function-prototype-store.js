// Sloppy code (CommonJS). The `prototype` of a generator function is writable: after a store, new generator objects inherit from the stored object.
function* gen() { yield 1; }
async function* agen() { yield 1; }
function t(what, f) { try { console.log(what + ":", f()); } catch (e) { console.log(what + ":", e.name); } }
var first = gen.prototype, afirst = agen.prototype;
t("a generator function", function () { gen.prototype = {}; return Object.getPrototypeOf(gen()) === first ? "the old one" : "replaced"; });
t("an async generator function", function () { agen.prototype = {}; return Object.getPrototypeOf(agen()) === afirst ? "the old one" : "replaced"; });
t("by a computed key", function () { var key = ["proto", "type"].join(""); gen[key] = {}; return Object.getPrototypeOf(gen()) === first ? "the old one" : "replaced"; });
t("the object it has already", function () { gen.prototype = first; return Object.getPrototypeOf(gen()) === first; });
t("by Reflect.set", function () { return [Reflect.set(gen, "prototype", {}), Object.getPrototypeOf(gen()) === first].join(); });
t("an ordinary function", function () { function plain() {} plain.prototype = { a: 1 }; return new plain().a; });
module.exports = 0;
