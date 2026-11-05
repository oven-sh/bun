// A definition that repeats or tightens what stands passes on a locked object; one that changes it is refused.
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
for (const [name, object] of Object.entries(targets)) {
  const key = Reflect.ownKeys(object).find(k => { const d = Object.getOwnPropertyDescriptor(object, k); return "value" in d && d.writable && d.configurable; });
  if (key === undefined) { console.log(name + ": nothing to tighten"); continue; }
  const was = Object.getOwnPropertyDescriptor(object, key);
  const verdicts = [
    "repeat " + told(() => Reflect.defineProperty(object, key, was)),
    "the same value " + told(() => Reflect.defineProperty(object, key, { value: was.value })),
    "read-only " + told(() => Reflect.defineProperty(object, key, { writable: false })),
    "read-only with the value " + told(() => Reflect.defineProperty(object, key, { value: was.value, writable: false })),
    "not configurable " + told(() => Reflect.defineProperty(object, key, { configurable: false })),
    "by Object.defineProperty " + told(() => Object.defineProperty(object, key, { value: was.value, writable: false, configurable: false, enumerable: was.enumerable })),
  ];
  const is = Object.getOwnPropertyDescriptor(object, key);
  console.log(name + "." + String(key) + ": " + verdicts.join(", ") + " | " + is.writable + " " + is.configurable + " " + (is.value === was.value));
}
console.log(told(() => Reflect.preventExtensions(Object.prototype)), told(() => Reflect.preventExtensions(Math)), Object.isExtensible(Object.prototype), Object.isExtensible(Math));
