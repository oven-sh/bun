"use strict";
const seen = new Set();
const found = [];
const visit = (path, value, depth) => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return;
  seen.add(value);
  found.push([path, value]);
  if (depth === 0) return;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    for (const part of ["value", "get", "set"]) visit(`${path}.${String(key)}, ${part}`, descriptor[part], depth - 1);
  }
  visit(`above ${path}`, Object.getPrototypeOf(value), depth);
};
const names = [
  "Object", "Function", "Array", "Number", "Boolean", "String", "Symbol", "BigInt", "Date", "Promise", "RegExp",
  "Error", "TypeError", "RangeError", "SyntaxError", "AggregateError", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int32Array", "Float64Array", "BigInt64Array", "Map", "Set", "WeakMap",
  "WeakSet", "WeakRef", "FinalizationRegistry", "Proxy", "Reflect", "JSON", "Math", "Atomics", "Intl", "Iterator",
  "console", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "Buffer", "AbortController", "AbortSignal", "Event",
  "CustomEvent", "EventTarget", "Headers", "Request", "Response", "Blob", "File",
];
for (const name of names) visit(name, globalThis[name], 2);

let stores = 0;
for (const [path, object] of found) {
  const above = Object.getPrototypeOf(object);
  for (const value of [above, 1, "text", undefined, true, 2n, Symbol.iterator]) {
    stores++;
    try {
      object.__proto__ = value;
    } catch (error) {
      console.log(path, typeof value, error.name, error.message);
    }
    if (!Reflect.set(object, "__proto__", value)) console.log(path, typeof value, "Reflect.set answers false");
    if (Object.getPrototypeOf(object) !== above) console.log(path, typeof value, "has moved");
  }
}
console.log(found.length > 300, stores === found.length * 7);
