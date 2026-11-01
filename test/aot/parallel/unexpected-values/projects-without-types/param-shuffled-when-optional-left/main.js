var lib = require("./lib/read");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function collect() {
  return Array.prototype.slice.call(arguments).map(function (operand) {
    return operand instanceof Error ? "an error" : operand;
  });
}
var length = 0;
for (var i = 0; i < 2000; i++) {
  length += lib.read("a.txt", { limit: 3 }, collect)[1].length + lib.range(0, 3, 1).length + lib.readAll(["a.txt"], {}, collect)[0].length + lib.on({}, "x", collect);
}
console.log("length", length);

attempt("read(name, options, callback)", function () { return lib.read("a.txt", { limit: 2, encoding: "upper" }, collect); });
attempt("read(name, callback)", function () { return lib.read("a.txt", collect); });
attempt("read(name, text, callback)", function () { return lib.read("a.txt", "upper", collect); });
attempt("read(name, null, callback)", function () { return lib.read("a.txt", null, collect); });
attempt("read(name, undefined, callback)", function () { return lib.read("a.txt", undefined, collect); });
attempt("read(name, 0, callback)", function () { return lib.read("a.txt", 0, collect); });
attempt("read(name, 5, callback)", function () { return lib.read("a.txt", 5, collect); });
attempt("read(name, a text limit, callback)", function () { return lib.read("a.txt", { limit: "2" }, collect); });
attempt("read(name, a fraction, callback)", function () { return lib.read("a.txt", { limit: 2.5 }, collect); });
attempt("read(name, a list, callback)", function () { return lib.read("a.txt", ["upper"], collect); });
attempt("read(absent, callback)", function () { return lib.read("c.txt", collect); });
attempt("read(a name of Object.prototype, callback)", function () { return lib.read("constructor", collect); });
attempt("read(name)", function () { return lib.read("a.txt"); });
attempt("read(name, options)", function () { return lib.read("a.txt", {}); });
attempt("read(name, options, no function)", function () { return lib.read("a.txt", {}, "callback"); });
attempt("readAll(list, callback)", function () { return lib.readAll(["a.txt", "b.txt", "c.txt"], collect); });
attempt("readAll(text, callback)", function () { return lib.readAll("a.txt", collect); });
attempt("readAll(text, text, callback)", function () { return lib.readAll("a.txt", "upper", collect); });
attempt("readAll(array-like, callback)", function () { return lib.readAll({ 0: "a.txt", length: 1 }, collect); });
attempt("range(3)", function () { return lib.range(3); });
attempt("range(1, 3)", function () { return lib.range(1, 3); });
attempt("range(0, 1, 0.25)", function () { return lib.range(0, 1, 0.25); });
attempt("range('3')", function () { return lib.range("3"); });
attempt("range('1', 3)", function () { return lib.range("1", 3); });
attempt("range(1, 3, '1')", function () { return lib.range(1, 3, "1"); });
attempt("range(null, 2)", function () { return lib.range(null, 2); });
attempt("range(0n, 2n, 1n)", function () { return lib.range(0n, 2n, 1n); });
attempt("range(0, 2n)", function () { return lib.range(0, 2n); });
attempt("range()", function () { return lib.range(); });
attempt("on(target, name, listener)", function () { var target = {}; return [lib.on(target, "a", collect), Object.keys(target)]; });
attempt("on(target, object)", function () { var target = {}; return [lib.on(target, { a: collect, b: collect }), Object.keys(target)]; });
attempt("on(target, list)", function () { var target = {}; return [lib.on(target, [collect]), Object.keys(target)]; });
attempt("on(target, null)", function () { return lib.on({}, null, collect); });
attempt("on(target with a text under the name)", function () { return lib.on({ a: "text" }, "a", collect); });
attempt("on(frozen target)", function () { return lib.on(Object.freeze({}), "a", collect); });
