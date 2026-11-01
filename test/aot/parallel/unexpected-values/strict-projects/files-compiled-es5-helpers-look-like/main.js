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
/* Output:
this file is strict: false
length 2051000
honest Array["Rex makes a sound: woof", true, 4, true, "counted by Dog", true]
a look-alike of __extends Array["Rex makes a sound: woof", false, 4, false, "no count", true]
what it logged Array["extends Dog Animal"]
helpers taken from this Array["Rex makes a sound: woof", false, 4, false, "no count", false]
__assign taken from this "the helper came from this"
keys behind the star "taken,Animal,Dog,changing,change,counted,fixed"
what was taken stays "defined before the star"
no default Array[false, false]
a getter runs each time Array[1, 2]
a member that changes Array[1, "changed"]
a fixed member Object{value: "fixed", writable: false, enumerable: true, configurable: false}
a store through the star threw TypeError
honest withDefaults(nothing) Object{width: 1, height: 1}
look-alike withDefaults(nothing) Object{width: 1, height: 1}
honest withDefaults(none) Object{width: 1, height: 1}
look-alike withDefaults(none) Object{width: 1, height: 1}
honest withDefaults(text) Object{0: "a", 1: "b", width: 1, height: 1}
look-alike withDefaults(text) Object{0: "a", 1: "b", width: 1, height: 1}
honest withDefaults(number) Object{width: 1, height: 1}
look-alike withDefaults(number) Object{width: 1, height: 1}
honest withDefaults(list) Object{0: 1, 1: 2, width: 1, height: 1}
look-alike withDefaults(list) Object{0: 1, 1: 2, width: 1, height: 1}
honest withDefaults(getter) Object{width: "from a getter", height: 1}
look-alike withDefaults(getter) Object{width: "from a getter", height: 1}
honest withDefaults(inherited) Object{width: 1, height: 1}
look-alike withDefaults(inherited) Object{width: "inherited", height: 1}
honest withDefaults(symbolKey) Object{width: 3, height: 1, Symbol(Symbol.iterator): 1}
look-alike withDefaults(symbolKey) Object{width: 3, height: 1}
honest joined(list) Array[1, 2, 9]
honest joinedWithoutPacking(list) Array[1, 2, 9]
honest joined(holes) Array[1, undefined, 3, 9]
honest joinedWithoutPacking(holes) Array[1, hole, 3, 9]
honest joined(like) Array["a", "b", 9]
honest joinedWithoutPacking(like) Array["a", "b", 9]
honest joined(text) threw TypeError
honest joinedWithoutPacking(text) Array["a", "b", 9]
honest joined(set) Array[9]
honest joinedWithoutPacking(set) Array[9]
honest joined(operands) Array[1, 2, 9]
honest joinedWithoutPacking(operands) Array[1, 2, 9]
honest joined(none) threw TypeError
honest joinedWithoutPacking(none) threw TypeError
honest joined(heir) Array[1, 2, 9]
honest joinedWithoutPacking(heir) Array[1, 2, 9]
look-alike joined Array[2, 1]
look-alike lastWins Object{a: "first"}
honest defaultOf Array["marked", "unmarked", null, Object{__esModule: 0, default: 1}]
look-alike defaultOf "always this"
before it is replaced Object{width: 2}
after it was replaced "replaced later"
*/
