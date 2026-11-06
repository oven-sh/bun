// RUN: lower
// OPTIONS: builtin-modules

// What polyfills and transpiler run-times (core-js, regenerator-runtime, es6-shim) rest on when they load: an ordinary object that inherits from a built-in prototype takes a property under the name of one of its members by plain assignment, and `delete` of a key that a built-in object does not have answers true. No member of a built-in object is changed. Each row answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("a weak map keeps its own copies of get, has and set", () => {
  const store = new WeakMap();
  store.get = store.get;
  store.has = store.has;
  store.set = store.set;
  const key = {};
  store.set(key, 1);
  return [Object.keys(store).join("+"), store.get === WeakMap.prototype.get, store.has(key), store.get(key)].join();
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
  delete Number.prototype.clz, delete Promise.accept, delete Promise.defer, delete Promise.prototype.chain, delete Object.prototype.absent, delete Array.prototype.absent, delete Array.prototype[5],
  delete Function.prototype.absent, delete String.prototype.absent, delete RegExp.prototype.absent, delete Symbol.absent, delete Map.prototype.absent, delete Uint8Array.absent, delete Uint8Array.prototype.absent,
  Reflect.deleteProperty(Promise.prototype, "chain"), Reflect.deleteProperty(Object.prototype, Symbol.for("absent")),
].join());
attempt("reading them before the delete", () => [Number.prototype.clz, Promise.accept, Promise.prototype.chain, "clz" in Number.prototype].join());

// GENERATED: GeneratorFunctionPrototype attempt [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="GeneratorFunctionPrototype"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = PropGet v15 key="constructor"
// CHECK-NEXT: v24 = PropGet v23 key="name"
// CHECK-NEXT: v25 = Add v22, v24
// CHECK-NEXT: v26 = Call v20, v18, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsNamedByComputedKey] captures=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
