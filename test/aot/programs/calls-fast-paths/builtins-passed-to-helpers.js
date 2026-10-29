// A library hands built-ins to a helper that keeps them in the variables of a closure: `overArg(Object.keys, Object)`. What the calls of the helper pass is predicted of its parameters, up to two built-ins a parameter.
// IR= 1 composed TypeTest v[0-9]+ testedType=builtin\(Object\)
// IR= 1 composed TypeTest v[0-9]+ testedType=builtin\(ObjectKeys\)
// IR= 1 composed TypeTest v[0-9]+ testedType=builtin\(ObjectGetPrototypeOf\)
// IR= 1 composed CallBuiltin - \(v[0-9]+\) overload=ObjectKeys/
// IR= 1 composed CallBuiltin - \(v[0-9]+\) overload=ObjectGetPrototypeOf/
// IR= 0 threeWays TypeTest v[0-9]+ testedType=builtin\(
var root = (typeof globalThis == "object" && globalThis && globalThis.Object === Object && globalThis) || Function("return this")();
function make(context) {
  var Object = context.Object, Math = context.Math;
  function overArg(func, transform) { return function composed(arg) { return func(transform(arg)); }; }
  function pickOne(func) { return function threeWays(a, b) { return func(a, b); }; }
  return {
    keys: overArg(Object.keys, Object),
    prototypeOf: overArg(Object.getPrototypeOf, Object),
    larger: pickOne(Math.max), smaller: pickOne(Math.min), power: pickOne(Math.pow),
    overArg: overArg,
  };
}
var library = make(root);
console.log(library.keys({ a: 1, b: 2 }).join(), library.keys("xy").join(), library.prototypeOf([]) === Array.prototype, library.prototypeOf(1) === Number.prototype);
console.log(library.larger(1, 2), library.smaller(1, 2), library.power(2, 5));
var other = library.overArg(function (value) { return "mine " + value; }, function (value) { return value + 1; });
console.log(other(1), library.keys({ c: 3 }).join());
try { library.keys(null); } catch (error) { console.log(error.name); }
