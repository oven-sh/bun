// Feature tests that polyfills (core-js, es-iterator-helpers) run when they load: an own Symbol.toStringTag, Promise.prototype.finally on a thenable, Array.prototype.toString on an object, the iterator method of typed arrays on an array, the legacy accessor methods called by their bare names. Each answers as in plain Bun.
function attempt(label, run) {
  try { console.log(label + ": " + String(run())); } catch (error) { console.log(label + ": " + error.constructor.name); }
}

attempt("an own Symbol.toStringTag", () => { const object = {}; object[Symbol.toStringTag] = "z"; return String(object); });
attempt("on an array and a function, by assignment", () => {
  const tagged = [[], function () {}];
  for (const value of tagged) value[Symbol.toStringTag] = "z";
  return tagged.map(value => Object.prototype.toString.call(value)).join();
});
attempt("on a promise, a map and a typed array, by definition", () => {
  const tagged = [Promise.resolve(), new Map(), new Uint8Array(1)];
  for (const value of tagged) Object.defineProperty(value, Symbol.toStringTag, { value: "z" });
  return tagged.map(value => Object.prototype.toString.call(value)).join();
});
attempt("on a map, by assignment, under a tag that is read-only", () => { const map = new Map(); map[Symbol.toStringTag] = "z"; return String(map); });
attempt("a tag that is no string", () => Object.prototype.toString.call({ [Symbol.toStringTag]: 5 }));
attempt("the tags of the built-in classes", () => [new Map(), new Set(), new WeakMap(), Promise.resolve(), Symbol(), 1n, new ArrayBuffer(0), new DataView(new ArrayBuffer(0)), new Uint8Array(0), [][Symbol.iterator](), (function* () {})(), Math, JSON].map(value => Object.prototype.toString.call(value)).join());

attempt("finally on a thenable", () => {
  const seen = [];
  const result = Promise.prototype.finally.call({ then(onFulfilled, onRejected) { seen.push(typeof onFulfilled, typeof onRejected); return "from then"; } }, () => {});
  return [result, seen].join();
});
attempt("finally on a thenable with a species", () => {
  function Other() {}
  const thenable = { constructor: { [Symbol.species]: Other }, then() { return 1; } };
  return Promise.prototype.finally.call(thenable, () => {});
});
attempt("finally on what is no object", () => Promise.prototype.finally.call(5, () => {}));

attempt("Array.prototype.toString on a plain object", () => [].toString.call({}));
attempt("on an object with join", () => [].toString.call({ join() { return "joined"; } }));
attempt("the iterator method of typed arrays refuses an array", () => Uint8Array.prototype[Symbol.iterator].call([1]));

attempt("__defineSetter__ by its bare name, on null", () => {
  const key = "key" + Math.random();
  __defineSetter__.call(null, key, function () {});
  return delete globalThis[key];
});
attempt("__defineGetter__ by its bare name, on undefined", () => __defineGetter__.call(undefined, "k", function () {}));
attempt("__lookupGetter__ and __lookupSetter__ by their bare names, on null", () => [__lookupGetter__.call(null, "k"), __lookupSetter__.call(null, "k")].join());
attempt("__defineGetter__ on an object", () => { const object = {}; object.__defineGetter__("k", () => 3); return [object.k, typeof object.__lookupGetter__("k")].join(); });
