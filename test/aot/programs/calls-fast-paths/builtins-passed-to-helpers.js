// A library hands built-ins to a helper that keeps them in the variables of a closure: `overArg(Object.keys, Object)`. What the calls of the helper pass is predicted of its parameters, up to two built-ins a parameter.
// IR= 1 composed IsBuiltinFunction v[0-9]+ Object$
// IR= 1 composed IsBuiltinFunction v[0-9]+ Object.keys
// IR= 1 composed IsBuiltinFunction v[0-9]+ Object.getPrototypeOf
// IR= 1 composed CallBuiltin Object.keys#
// IR= 1 composed CallBuiltin Object.getPrototypeOf#
// IR= 0 threeWays IsBuiltinFunction
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
