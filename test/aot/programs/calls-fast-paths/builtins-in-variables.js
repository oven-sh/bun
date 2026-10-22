// A library keeps the built-ins it uses in variables that it fills from an object it is handed. They are predicted, so a call through such a variable is carried out in place.
// IR= 1 isList TypeTest v[0-9]+ testedType=builtin\(ArrayIsArray\)
// IR= 1 isList CallBuiltin - \(v[0-9]+\) overload=ArrayIsArray/
// IR= 1 has TypeTest v[0-9]+ testedType=builtin\(ObjectPrototypeHasOwnProperty\)
// IR= 1 has CallBuiltin .* overload=Object(PrototypeHasOwnProperty|HasOwn)/
// IR= 1 larger TypeTest v[0-9]+ testedType=builtin\(MathMax\)
// IR= 1 larger CallBuiltin - \(v[0-9]+, v[0-9]+\) overload=MathMax/
// IR= 1 listOf TypeTest v[0-9]+ testedType=builtin\(Array\)
// IR= 1 listOf CallBuiltin - \(v[0-9]+\) overload=Array/
// IR= 1 asObject TypeTest v[0-9]+ testedType=builtin\(Object\)
// IR= 1 asObject CallBuiltin - \(v[0-9]+\) overload=Object/
// IR= 1 keysOf TypeTest v[0-9]+ testedType=builtin\(Object\)
// IR= 1 keysOf CallBuiltin - \(v[0-9]+\) overload=ObjectKeys/
var root = (typeof globalThis == "object" && globalThis && globalThis.Object === Object && globalThis) || Function("return this")();
function make(context) {
  context = context == null ? root : context;
  var Array = context.Array, Math = context.Math, Object = context.Object;
  var objectPrototype = Object.prototype, hasOwnProperty = objectPrototype.hasOwnProperty;
  var isArray = Array.isArray, max = Math.max;
  function isList(value) { return isArray(value); }
  function has(object, key) { return hasOwnProperty.call(object, key); }
  function larger(a, b) { return max(a, b); }
  function listOf(length) { return Array(length); }
  function asObject(value) { return Object(value); }
  function keysOf(value) { return Object.keys(value); }
  return { isList: isList, has: has, larger: larger, listOf: listOf, asObject: asObject, keysOf: keysOf };
}
var library = make();
var object = { a: 1 }, list = library.listOf(2);
list[0] = "x";
list[1] = "y";
console.log(library.isList([]), library.isList(object), library.isList("[]"), library.has(object, "a"), library.has(object, "b"), library.has(list, 1), library.has(list, 2));
console.log(library.larger(1, 2), library.larger(2.5, -1), library.larger("3", 2), library.larger(NaN, 1), list.length, list.join(), library.listOf(0).length);
console.log(library.asObject(object) === object, typeof library.asObject(1), library.keysOf(object).join(), library.keysOf("ab").join());
