// Object.freeze on the built-in objects that are locked in a compiled executable: it does what it does under bun run.
const targets = {
  "Object.prototype": Object.prototype, "Array.prototype": Array.prototype, "Function.prototype": Function.prototype, "Promise.prototype": Promise.prototype,
  "Map.prototype": Map.prototype, "Set.prototype": Set.prototype, "String.prototype": String.prototype, "Number.prototype": Number.prototype, "RegExp.prototype": RegExp.prototype,
  "Date.prototype": Date.prototype, "Error.prototype": Error.prototype, "Symbol.prototype": Symbol.prototype, "Uint8Array.prototype": Uint8Array.prototype,
  "%TypedArray%.prototype": Object.getPrototypeOf(Uint8Array.prototype), "%IteratorPrototype%": Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
  Object, Array, Function, Promise, Map, String, Number, Symbol, Error, RegExp, Date, JSON, Math, Reflect, Atomics, Intl,
  "Array.prototype.map": Array.prototype.map, "Object.keys": Object.keys, "Math.max": Math.max, "JSON.parse": JSON.parse, parseInt,
  "Request.prototype": Request.prototype, "Response.prototype": Response.prototype, "Headers.prototype": Headers.prototype, "URL.prototype": URL.prototype, "Buffer.prototype": Buffer.prototype,
  Request, URL, Buffer, "EventTarget.prototype": EventTarget.prototype,
};
const told = run => { try { const answer = run(); return typeof answer === "object" || typeof answer === "function" ? "done" : String(answer); } catch (error) { return error.constructor.name; } };
function stateOf(object) {
  const keys = Reflect.ownKeys(object);
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(object, key));
  return [
    "frozen " + Object.isFrozen(object), "sealed " + Object.isSealed(object), "extensible " + Object.isExtensible(object),
    "configurable " + descriptors.filter(d => d.configurable).length + " writable " + descriptors.filter(d => d.writable).length + " of " + keys.length,
    "add " + told(() => { "use strict"; object.somethingNew = 1; return "somethingNew" in object; }),
    "define " + told(() => Reflect.defineProperty(object, "somethingElse", { value: 1 })),
  ].join(", ");
}
for (const [name, object] of Object.entries(targets)) console.log(name + ": " + told(() => Object.freeze(object)) + " | " + stateOf(object));
console.log([1, 2].map(x => x * 2).join(), Object.keys({ a: 1 }).join(), Math.max(1, 2), JSON.parse("[1]").length, new Map([[1, 2]]).get(1), "a".padStart(2), new URL("http://x/y").pathname);
