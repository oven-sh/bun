// A variable that is predicted to hold a built-in function holds something else: a look-alike from the object the library was handed, another value stored later, nothing at all.
var root = (typeof globalThis == "object" && globalThis && globalThis.Object === Object && globalThis) || Function("return this")();
var log = [];
function make(context) {
  context = context == null ? root : context;
  var Array = context.Array, Math = context.Math, Object = context.Object;
  var hasOwnProperty = Object.prototype.hasOwnProperty, toText = Object.prototype.toString;
  var isArray = Array.isArray, max = Math.max;
  return {
    isList: function (value) { return isArray(value); },
    has: function (object, key) { return hasOwnProperty.call(object, key); },
    text: function (value) { return toText.call(value); },
    larger: function (a, b) { return max(a, b); },
    listOf: function (length) { return Array(length); },
    made: function (length) { return new Array(length); },
    asObject: function (value) { return Object(value); },
    keysOf: function (value) { return Object.keys(value); },
    forget: function () { isArray = undefined; },
    replace: function (other) { max = other; },
  };
}
function show(name, run) {
  try { log.push(name + ": " + JSON.stringify(run())); } catch (error) { log.push(name + ": " + error.name); }
}
function exercise(name, library) {
  show(name + " isList", function () { return [library.isList([1]), library.isList({ length: 1 }), library.isList(undefined)]; });
  show(name + " has", function () { return [library.has({ a: 1 }, "a"), library.has({ a: 1 }, "toString"), library.has("ab", 1), library.has([1], "length")]; });
  show(name + " has of nothing", function () { return library.has(null, "a"); });
  show(name + " text", function () { return [library.text([]), library.text(null), library.text(1), library.text(function () {})]; });
  show(name + " larger", function () { return [library.larger(1, 2), library.larger(-0, 0), library.larger("a", 1), library.larger({ valueOf: function () { log.push("valueOf"); return 7; } }, 3)]; });
  show(name + " listOf", function () { return [library.listOf(3).length, library.listOf("3").length, library.listOf(0).length, library.made(2).length]; });
  show(name + " listOf too long", function () { return library.listOf(-1); });
  show(name + " asObject", function () { return [typeof library.asObject("a"), typeof library.asObject(null), library.asObject(log) === log]; });
  show(name + " keysOf", function () { return [library.keysOf({ b: 1, a: 2 }), library.keysOf([5, 6])]; });
  show(name + " keysOf nothing", function () { return library.keysOf(undefined); });
}
exercise("real", make());
exercise("real again", make(root));
function FakeArray(length) { log.push("FakeArray " + length + " " + (this instanceof FakeArray)); return { length: "fake" }; }
FakeArray.isArray = function (value) { log.push("fake isArray"); return "fake"; };
function FakeObject(value) { log.push("FakeObject"); return "fake"; }
FakeObject.prototype.hasOwnProperty = function (key) { log.push("fake hasOwnProperty " + key + " " + typeof this); return "fake"; };
FakeObject.prototype.toString = function () { return "fake " + typeof this; };
FakeObject.keys = function (value) { return ["fake", this === FakeObject]; };
exercise("fake", make({ Array: FakeArray, Math: { max: function (a, b) { return "fake " + a + " " + b + " " + (this === undefined); } }, Object: FakeObject }));
var swapped = make({ Array: { isArray: Math.max }, Math: { max: Array.isArray }, Object: Object });
show("swapped", function () { return [swapped.isList(3), swapped.larger([], 1), swapped.larger(1, [])]; });
var changing = make();
show("before", function () { return [changing.isList([]), changing.larger(1, 2)]; });
changing.forget();
changing.replace(function () { return arguments.length; });
show("after forget", function () { return changing.isList([]); });
show("after replace", function () { return changing.larger(1, 2); });
changing.replace(Math.min);
show("after min", function () { return changing.larger(1, 2); });
console.log(log.join("\n"));
