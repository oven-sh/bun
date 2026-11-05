// An empty object that is filled in a loop with the keys another object was asked for shares its shape with the one that was filled so before it, also where the function that lists the keys is held in a constant, as Bun's own modules hold it.
const { describe } = require("bun:jsc");
const { EventEmitter } = require("node:events");
const ReflectOwnKeys = Reflect.ownKeys;
const ObjectKeys = Object.keys;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectEntries = Object.entries;
function byOwnKeys(source, removed) {
  const copy = Object.create(null);
  const keys = ReflectOwnKeys(source);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    if (key !== removed) copy[key] = source[key];
  }
  return copy;
}
function byKeys(source) {
  const copy = {};
  for (const key of ObjectKeys(source)) copy[key] = source[key];
  return copy;
}
function byNames(source) {
  const copy = {};
  const names = ObjectGetOwnPropertyNames(source);
  for (let i = 0; i < names.length; i++) copy[names[i]] = source[names[i]];
  return copy;
}
function byEntries(source) {
  const copy = {};
  for (const [key, value] of ObjectEntries(source)) copy[key] = value;
  return copy;
}
function byWords(words) {
  const counts = {};
  for (let i = 0; i < words.length; i++) counts[words[i]] = (counts[words[i]] ?? 0) + 1;
  return counts;
}
const isDictionary = object => /dictionary/i.test(describe(object));
const source = { x: 1, y: 2, z: 3 };
const copiers = [byOwnKeys, byKeys, byNames, byEntries];
for (const copier of copiers) {
  copier(source, "z");
  const copy = copier(source, "z");
  console.log(copier.name, JSON.stringify(copy), isDictionary(copy));
}
console.log(JSON.stringify(byWords(["a", "b", "a"])));
const listener = () => {};
// Each emitter goes one round further with shared shapes than the one before it.
for (let nth = 1; nth <= 4; nth++) {
  const emitter = new EventEmitter();
  emitter.on("kept", listener);
  for (let round = 0; round < 3; round++) {
    emitter.on("passing", listener);
    emitter.off("passing", listener);
    if (nth === 4) console.log(emitter.eventNames().join(), isDictionary(emitter._events));
  }
}
