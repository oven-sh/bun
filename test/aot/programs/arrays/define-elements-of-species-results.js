// map, filter and their like define the elements of their result with CreateDataPropertyOrThrow. The result is whatever the species constructor answers: an ordinary array takes the element by its index, and each other kind of object here answers as the language says: it throws, replaces an accessor without calling it, grows, or converts.
function withSpecies(create) {
  const source = [10, 20, 30];
  source.constructor = { [Symbol.species]: create };
  return source;
}
function attempt(name, create, inspect) {
  let made;
  const source = withSpecies(function (length) { return made = create(length); });
  for (const [method, run] of [["map", list => list.map(x => x + 1)], ["filter", list => list.filter(x => x > 10)], ["slice", list => list.slice(1)]]) {
    try {
      const result = run(source);
      console.log(name, method, result === made, inspect ? inspect(result) : JSON.stringify(result), "length" in result ? result.length : "no length");
    } catch (error) {
      console.log(name, method, "throws", error.constructor.name);
    }
  }
}
attempt("ordinary", length => new Array(length));
attempt("empty literal", () => []);
attempt("filled literal", () => [1, 2, 3, 4, 5]);
attempt("of fractions", () => [0.5, 1.5]);
attempt("of strings", () => ["a"]);
attempt("frozen", () => Object.freeze([]));
attempt("sealed with room", () => Object.seal([1, 2, 3]));
attempt("not extensible", () => Object.preventExtensions([]));
attempt("fixed length", () => Object.defineProperty([], "length", { writable: false }));
attempt("read-only element", () => Object.defineProperty([1, 2, 3], 0, { value: 7, writable: false, configurable: false }));
attempt("read-only configurable element", () => Object.defineProperty([1, 2, 3], 0, { value: 7, writable: false, configurable: true }), result => JSON.stringify(result) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(result, 0)));
let setterCalls = 0;
attempt("accessor element", () => Object.defineProperty([1, 2, 3], 0, { get() { return -1; }, set() { ++setterCalls; }, configurable: true }), result => JSON.stringify(result) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(result, 0)));
console.log("setter calls:", setterCalls);
attempt("sparse", () => { const list = []; list[1000000] = 1; return list; }, result => result[0] + " " + result[1] + " " + result[1000000]);
attempt("plain object", () => ({}));
attempt("typed array", length => new Uint8Array(length || 3), result => Array.from(result).join());
attempt("subclass", length => new (class Numbers extends Array {})(length), result => result.constructor.name + " " + JSON.stringify(result));
attempt("proxy", () => new Proxy([], { defineProperty(target, key, descriptor) { console.log("  defineProperty", String(key), JSON.stringify(descriptor)); return Reflect.defineProperty(target, key, descriptor); } }));
