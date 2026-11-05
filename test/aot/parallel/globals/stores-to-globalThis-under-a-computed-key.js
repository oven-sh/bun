// A store under a key nobody knows lands on the global object through globalThis, however the property changes in between.
const holder = process.argv.length > 50 ? {} : globalThis;
function write(key, value) {
  holder[key] = value;
}
function strictWrite(key, value) {
  "use strict";
  holder[key] = value;
}
function attempt(store, key, value) {
  try {
    store(key, value);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
function repeat(key, rounds = 40) {
  for (let i = 0; i < rounds; i++) write(key, i);
  return holder[key];
}
const name = ["sha", "red"].join("");

console.log("added", repeat(name), globalThis.shared, shared);
function readByName() {
  return shared;
}
for (let i = 0; i < 40; i++) readByName();
console.log("read by name", readByName());
write(name, "new");
console.log("read by name behind a store", readByName());
for (let i = 0; i < 40; i++) write(name, i);
console.log("again", readByName(), globalThis[name]);

const symbol = Symbol("shared");
console.log("symbol", repeat(symbol), globalThis[symbol]);

let stored = "nothing";
Object.defineProperty(globalThis, name, {
  get() {
    return stored;
  },
  set(value) {
    stored = value;
  },
  configurable: true,
});
console.log("setter", repeat(name), stored);

Object.defineProperty(globalThis, name, { value: "fixed", writable: false, configurable: true });
console.log("read only", attempt(write, name, 1), attempt(strictWrite, name, 2), globalThis[name], readByName());

Object.defineProperty(globalThis, name, { value: "open", writable: true, configurable: true, enumerable: false });
console.log("writable again", repeat(name), Object.getOwnPropertyDescriptor(globalThis, name).enumerable);

delete globalThis[name];
console.log("deleted", name in globalThis, attempt(readByName, name));
console.log("added again", repeat(name), Object.getOwnPropertyDescriptor(globalThis, name).enumerable, readByName());

console.log(
  "inherited",
  repeat("isPrototypeOf"),
  Object.hasOwn(globalThis, "isPrototypeOf"),
  Object.prototype.isPrototypeOf === globalThis.isPrototypeOf,
);

const original = globalThis.setTimeout;
console.log("a built-in", repeat("setTimeout"), typeof setTimeout);
globalThis.setTimeout = original;
console.log("put back", typeof setTimeout);

const index = ["1", "2"].join("");
console.log("an index", repeat(index), globalThis[12]);
const protoKey = ["__pro", "to__"].join("");
const protoBefore = Object.getPrototypeOf(globalThis);
console.log("__proto__", attempt(write, protoKey, 5), Object.getPrototypeOf(globalThis) === protoBefore);

const below = Object.create(globalThis);
below[name] = "below";
console.log("below", globalThis[name], below[name], Object.hasOwn(below, name));

Object.freeze(Object.prototype);
console.log("frozen above", repeat(name));
const newName = ["fre", "sh"].join("");
Object.seal(globalThis);
console.log(
  "sealed",
  attempt(strictWrite, newName, 1),
  attempt(strictWrite, name, 7),
  globalThis[name],
  newName in globalThis,
);
Object.freeze(globalThis);
console.log("frozen", attempt(strictWrite, name, 8), attempt(write, name, 9), globalThis[name]);
