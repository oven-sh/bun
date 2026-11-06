var attempt = require("./show").attempt;
var honest = require("./honest");
var tools = require("./honest/tools");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function speak(animals) {
  var dog = new animals.Dog("Rex");
  return [dog.speak(), dog instanceof animals.Animal, dog.legs, Object.getPrototypeOf(animals.Dog) === animals.Animal, typeof animals.Dog.count === "function" ? animals.Dog.count() : "no count", dog.constructor === animals.Dog];
}
var length = 0;
for (var i = 0; i < 2000; i++) length += speak(honest)[0].length + tools.withDefaults({ width: i }).width + tools.joined([i], [1]).length + tools.merged({ a: 1 }, { b: 2 }).a;
console.log("length", length);

attempt("honest", function () { return speak(honest); });
attempt("a look-alike of __extends", function () { return speak(require("./lookalikes/animals")); });
attempt("what it logged", function () { return require("./lookalikes/animals").log; });
attempt("helpers taken from this", function () { return speak(require("./lookalikes/taken-from-this")); });
attempt("__assign taken from this", function () { return require("./lookalikes/taken-from-this").withDefaults({ width: 2 }); });

attempt("keys behind the star", function () { return Object.keys(honest).join(); });
attempt("what was taken stays", function () { return honest.taken; });
attempt("no default", function () { return ["default" in honest, "hidden" in honest]; });
attempt("a getter runs each time", function () { return [honest.counted, honest.counted]; });
attempt("a member that changes", function () { var before = honest.changing; honest.change(); return [before, honest.changing]; });
attempt("a fixed member", function () { return Object.getOwnPropertyDescriptor(honest, "fixed"); });
attempt("a store through the star", function () { "use strict"; honest.changing = 1; return honest.changing; });

var operands = { nothing: undefined, none: null, text: "ab", number: 5, list: [1, 2], getter: { get width() { return "from a getter"; } }, inherited: Object.create({ width: "inherited" }), symbolKey: { [Symbol.iterator]: 1, width: 3 } };
Object.keys(operands).forEach(function (name) {
  attempt("honest withDefaults(" + name + ")", function () { return tools.withDefaults(operands[name]); });
  attempt("look-alike withDefaults(" + name + ")", function () { return require("./lookalikes/tools").withDefaults(operands[name]); });
});
var lists = { list: [1, 2], holes: [1, , 3], like: { 0: "a", 1: "b", length: 2 }, text: "ab", set: new Set([1]), operands: (function () { return arguments; })(1, 2), none: null, heir: Object.create([1, 2]) };
Object.keys(lists).forEach(function (name) {
  attempt("honest joined(" + name + ")", function () { return tools.joined(lists[name], [9]); });
  attempt("honest joinedWithoutPacking(" + name + ")", function () { return tools.joinedWithoutPacking(lists[name], [9]); });
});
attempt("look-alike joined", function () { return require("./lookalikes/tools").joined([1], [2]); });
attempt("look-alike lastWins", function () { return require("./lookalikes/tools").lastWins(); });
attempt("honest defaultOf", function () { return [tools.defaultOf({ __esModule: true, default: "marked" }), tools.defaultOf("unmarked"), tools.defaultOf(null), tools.defaultOf({ __esModule: 0, default: 1 })]; });
attempt("look-alike defaultOf", function () { return require("./lookalikes/tools").defaultOf({ __esModule: true, default: "marked" }); });
var later = require("./lookalikes/replaced-later");
attempt("before it is replaced", function () { return later.withDefaults({ width: 2 }); });
later.replace();
attempt("after it was replaced", function () { return later.withDefaults({ width: 2 }); });
