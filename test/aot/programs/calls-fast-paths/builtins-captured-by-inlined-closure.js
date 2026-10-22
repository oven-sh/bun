// `nativeKeys = overArg(Object.keys, Object)`: the closure is small and is copied into whoever calls it: there what it captured is read out of the closure, and what is predicted of the parameters of its function is predicted of those reads too.
// IR= 1 keysOf TypeTest v[0-9]+ testedType=builtin\(Object\)
// IR= 1 keysOf TypeTest v[0-9]+ testedType=builtin\(ObjectKeys\)
// IR= 1 prototypeOf TypeTest v[0-9]+ testedType=builtin\(Object\)
// IR= 1 prototypeOf TypeTest v[0-9]+ testedType=builtin\(ObjectGetPrototypeOf\)
var root = (typeof globalThis == "object" && globalThis && globalThis.Object === Object && globalThis) || Function("return this")();
function make(context) {
  var Object = context.Object;
  function overArg(func, transform) { return function (arg) { return func(transform(arg)); }; }
  var nativeKeys = overArg(Object.keys, Object), getPrototype = overArg(Object.getPrototypeOf, Object);
  function keysOf(value) { return nativeKeys(value); }
  function prototypeOf(value) { return getPrototype(value); }
  return { keysOf: keysOf, prototypeOf: prototypeOf, overArg: overArg };
}
var library = make(root);
console.log(library.keysOf({ a: 1, b: 2 }).join(), library.keysOf("xy").join(), library.keysOf([7, 8, 9]).join(), library.prototypeOf([]) === Array.prototype, library.prototypeOf(1) === Number.prototype, library.prototypeOf(Object.create(null)));
var other = library.overArg(function (value) { return "mine " + value; }, function (value) { return value + 1; });
console.log(other(1), library.keysOf({ c: 3 }).join());
for (var value of [null, undefined]) { try { library.keysOf(value); } catch (error) { console.log(error.name); } try { library.prototypeOf(value); } catch (error) { console.log(error.name); } }
