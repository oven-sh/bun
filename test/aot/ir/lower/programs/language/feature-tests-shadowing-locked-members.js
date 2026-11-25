// RUN: lower
// OPTIONS: builtin-modules

// An ordinary object that inherits from a built-in prototype takes a property under the name of one of its members by plain assignment, and `delete` of a key that a built-in object does not have answers true. No member of a built-in object is changed. Each row answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("a weak map keeps its own copies of get, has and set", () => {
  const cloaks = new WeakMap(), hook = {};
  const { get, has, set } = cloaks;
  cloaks.set = set;
  cloaks.has = has;
  cloaks.get = get;
  cloaks.set(hook, 1);
  return [Object.keys(cloaks).reverse().join("+"), cloaks.get === WeakMap.prototype.get, cloaks.has(hook), cloaks.get(hook)].join();
});
attempt("the same on a map, a set, an array, a promise, a regular expression, a function", () => {
  const rows = [];
  for (const [value, names] of [[new Map(), ["get", "set", "has"]], [new Set(), ["add", "has"]], [[], ["push", "slice", "toString"]], [Promise.resolve(), ["then", "catch"]], [/a/, ["exec", "test"]], [function () {}, ["call", "apply", "bind", "toString"]], [new Uint8Array(1), ["subarray", "set"]]]) {
    for (const name of names) value[name] = value[name];
    rows.push(names.every(name => Object.hasOwn(value, name)));
  }
  return rows.join();
});

const IteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
function Generator() {}
function GeneratorFunction() {}
function GeneratorFunctionPrototype() {}
const Gp = (GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(IteratorPrototype));
GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
GeneratorFunctionPrototype.constructor = GeneratorFunction;
attempt("an object under the prototype of iterators takes Symbol.iterator and toString", () => {
  Gp[Symbol.iterator] = function () { return this; };
  Gp.toString = function () { return "[object Generator]"; };
  const made = Object.create(Gp);
  return [Object.hasOwn(Gp, Symbol.iterator), made[Symbol.iterator]() === made, String(made), IteratorPrototype[Symbol.iterator] === Gp[Symbol.iterator]].join();
});
attempt("and next, return, throw and a tag", () => {
  for (const method of ["next", "throw", "return"]) Gp[method] = function (argument) { return { value: method + argument, done: true }; };
  Object.defineProperty(Gp, Symbol.toStringTag, { value: "Generator", enumerable: true, configurable: true, writable: true });
  const made = Object.create(Gp);
  return [made.next(1).value, made.return(2).value, Object.prototype.toString.call(made), [...{ [Symbol.iterator]: () => made }].length].join();
});
attempt("its constructor by assignment", () => [Gp.constructor === GeneratorFunctionPrototype, Object.hasOwn(Gp, "constructor")].join());

attempt("objects under the other prototypes", () => {
  const rows = [];
  for (const [prototype, names] of [[Object.prototype, ["toString", "valueOf", "hasOwnProperty", "constructor"]], [Array.prototype, ["push", "length", "constructor"]], [Function.prototype, ["call", "name", "toString"]], [Promise.prototype, ["then", "constructor"]], [RegExp.prototype, ["exec", "flags", "source"]], [String.prototype, ["at", "length"]], [Map.prototype, ["get", "size"]], [Symbol.prototype, ["description", "toString"]]]) {
    const under = Object.create(prototype);
    for (const name of names) {
      let outcome;
      try { under[name] = 1; outcome = Object.hasOwn(under, name) ? "own" : "ignored"; } catch (error) { outcome = error.constructor.name; }
      rows.push(name + " " + outcome);
    }
  }
  return rows.join();
});

attempt("delete of keys that are not there", () => [
  delete Number.prototype.absent, delete Promise.absent, delete Promise.later, delete Promise.prototype.absent, delete Object.prototype.absent, delete Array.prototype.absent, delete Array.prototype[5],
  delete Function.prototype.absent, delete String.prototype.absent, delete RegExp.prototype.absent, delete Symbol.absent, delete Map.prototype.absent, delete Uint8Array.absent, delete Uint8Array.prototype.absent,
  Reflect.deleteProperty(Promise.prototype, "later"), Reflect.deleteProperty(Object.prototype, Symbol.for("absent")),
].join());
attempt("reading them before the delete", () => [Number.prototype.absent, Promise.absent, Promise.prototype.later, "absent" in Number.prototype].join());

// CHECK-LABEL: function {{*}}name="GeneratorFunctionPrototype"
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
