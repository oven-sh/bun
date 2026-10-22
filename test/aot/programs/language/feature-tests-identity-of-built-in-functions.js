// Feature tests that polyfills (core-js, es5-shim, es6-shim, es-iterator-helpers) run when they load: two names of a prototype that must hold one function, the names and lengths of built-in functions, the text of a built-in constructor, members of Iterator.prototype that are accessors. Nothing is written. Each answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("trimLeft is trimStart, trimRight is trimEnd", () => ["".trimLeft === "".trimStart, "".trimRight === "".trimEnd, "".trimLeft.name, "".trimRight.name].join());
attempt("toString of typed arrays is that of arrays", () => [Uint8Array.prototype.toString === [].toString, Object.getPrototypeOf(Uint8Array.prototype).toString === Array.prototype.toString, Object.hasOwn(Uint8Array.prototype, "toString")].join());
attempt("the iterator method is values", () => [
  Uint8Array.prototype[Symbol.iterator] === Uint8Array.prototype.values, Uint8Array.prototype.values.name,
  Array.prototype[Symbol.iterator] === Array.prototype.values, Array.prototype.values.name,
  Set.prototype[Symbol.iterator] === Set.prototype.values, Set.prototype.values.name,
  Map.prototype[Symbol.iterator] === Map.prototype.entries, Map.prototype.entries.name,
].join());
attempt("keys of a set is values", () => Set.prototype.keys === Set.prototype.values);
attempt("read from instances", () => [[].values === [][Symbol.iterator], new Set().keys === new Set().values, new Uint8Array(0).toString === [].toString, new Map().entries === new Map()[Symbol.iterator]].join());
attempt("toGMTString is toUTCString", () => Date.prototype.toGMTString === Date.prototype.toUTCString);
attempt("parseFloat and parseInt of Number", () => [Number.parseFloat === parseFloat, Number.parseInt === parseInt].join());

attempt("lengths", () => [
  String.prototype.lastIndexOf.length, String.prototype.indexOf.length, String.prototype.split.length, String.prototype.replace.length,
  Promise.all.length, Promise.race.length, Promise.resolve.length, Promise.reject.length, Promise.length,
  Map.length, Set.length, WeakMap.length, WeakSet.length, Array.prototype.concat.length, Array.prototype.push.length, Array.from.length,
  Function.prototype.bind.length, Function.prototype.call.length, Function.prototype.apply.length, Object.assign.length, Symbol.length,
].join());
attempt("names", () => [
  Array.prototype[Symbol.iterator].name, RegExp.prototype[Symbol.split].name, Symbol.prototype[Symbol.toPrimitive].name, Function.prototype[Symbol.hasInstance].name,
  Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get.name, Object.getOwnPropertyDescriptor(Map.prototype, "size").get.name,
  Object.getOwnPropertyDescriptor(Array, Symbol.species).get.name, Object.getOwnPropertyDescriptor(Symbol.prototype, "description").get.name,
].join());

attempt("the text of a built-in constructor", () => [WeakMap, Promise, Map, Set, Symbol, Array.prototype.push, "".trim, Function.prototype].map(f => /native code/.test(String(f))).join());
attempt("by Function.prototype.toString", () => [/native code/.test(Function.prototype.toString.call(Promise)), Function.prototype.toString.call(WeakMap) === String(WeakMap), String(String).split("String").length].join());

attempt("constructor and the tag of Iterator.prototype are accessors", () => {
  const constructor = Object.getOwnPropertyDescriptor(Iterator.prototype, "constructor");
  const tag = Object.getOwnPropertyDescriptor(Iterator.prototype, Symbol.toStringTag);
  return [typeof constructor.get, typeof constructor.set, constructor.enumerable, constructor.configurable, typeof tag.get, typeof tag.set, tag.get.call(), constructor.get.call() === Iterator].join();
});
attempt("an object under Iterator.prototype takes both by assignment", () => {
  const under = Object.create(Iterator.prototype);
  under.constructor = 1;
  under[Symbol.toStringTag] = "mine";
  return [Object.hasOwn(under, "constructor"), under.constructor, Object.prototype.toString.call(under), Iterator.prototype.constructor === Iterator, Iterator.prototype[Symbol.toStringTag]].join();
});
