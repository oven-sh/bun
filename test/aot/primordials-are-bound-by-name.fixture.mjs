// Prints all that a program could see of what internal/primordials exports, and holds the safe classes against what walking the keys of their built-ins gives (Node's makeSafe).
import { exposedInternals } from "bun:internal-for-testing";

const primordials = exposedInternals["internal/primordials"];
const attributes = descriptor =>
  ("value" in descriptor ? (descriptor.writable ? "w" : "-") : "a") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
const isSealedClass = constructor =>
  Object.isFrozen(constructor) && Object.isFrozen(constructor.prototype) && Object.getPrototypeOf(constructor.prototype) === null;

function membersByWalking(unsafe) {
  const members = [];
  const makesIterators = Symbol.iterator in unsafe.prototype;
  const dummy = makesIterators ? new unsafe() : undefined;
  for (const key of Reflect.ownKeys(unsafe.prototype)) {
    if (key === "constructor") continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(unsafe.prototype, key);
    let makesIterator = false;
    if (makesIterators && typeof descriptor.value === "function" && descriptor.value.length === 0) {
      const called = descriptor.value.call(dummy) || {};
      makesIterator = Symbol.iterator in (typeof called === "object" ? called : {});
    }
    members.push({ holder: "prototype", key, descriptor, makesIterator });
  }
  for (const key of Reflect.ownKeys(unsafe)) {
    if (key !== "length" && key !== "name" && key !== "prototype")
      members.push({ holder: "constructor", key, descriptor: Reflect.getOwnPropertyDescriptor(unsafe, key), makesIterator: false });
  }
  return members;
}

for (const [name, unsafe, contents] of [
  ["SafeMap", Map, [[1, 2], [3, 4]]],
  ["SafeSet", Set, [1, 3]],
  ["SafeWeakMap", WeakMap, []],
]) {
  const safe = primordials[name];
  console.log(name, safe.name, safe.length, Object.getPrototypeOf(safe) === unsafe, isSealedClass(safe), new safe(contents) instanceof unsafe);
  console.log(" ", Reflect.ownKeys(safe.prototype).map(String).join());
  console.log(" ", Reflect.ownKeys(safe).map(String).join());

  const members = membersByWalking(unsafe);
  const keysOf = holder => {
    const keys = members.filter(member => member.holder === holder).map(member => member.key);
    return [...keys.filter(key => typeof key === "string"), ...keys.filter(key => typeof key === "symbol")];
  };
  const sameKeys = (found, expected) => found.length === expected.length && found.every((key, index) => key === expected[index]);
  console.log("  the keys are those of the walk:", sameKeys(Reflect.ownKeys(safe.prototype), ["constructor", ...keysOf("prototype")]), sameKeys(Reflect.ownKeys(safe), ["length", "name", "prototype", ...keysOf("constructor")]));

  const wrappers = new Set();
  const classes = new Set();
  for (const { holder, key, descriptor, makesIterator } of members) {
    const found = Reflect.getOwnPropertyDescriptor(holder === "prototype" ? safe.prototype : safe, key);
    if (!makesIterator) {
      const isTheSame = "value" in descriptor ? found.value === descriptor.value : found.get === descriptor.get && found.set === descriptor.set;
      console.log(" ", holder, String(key), attributes(found), found.enumerable === descriptor.enumerable, isTheSame);
      continue;
    }
    const iterator = found.value.call(new safe(contents));
    wrappers.add(found.value);
    classes.add(iterator.constructor);
    console.log(" ", holder, String(key), attributes(found), JSON.stringify(found.value.name), found.value.length, found.value !== descriptor.value);
    console.log("   ", iterator.constructor.name, isSealedClass(iterator.constructor), Reflect.ownKeys(iterator.constructor.prototype).map(String).join(), Reflect.ownKeys(iterator).join());
    console.log("   ", iterator[Symbol.iterator]() === iterator, JSON.stringify([...iterator]), JSON.stringify([...descriptor.value.call(new unsafe(contents))]));
  }
  console.log("  wrappers and classes, each its own:", wrappers.size, classes.size, members.filter(member => member.makesIterator).length);
}

const { SafeArrayIterator, SafeStringIterator } = primordials;
console.log(SafeArrayIterator.name, SafeStringIterator.name, SafeArrayIterator !== SafeStringIterator, isSealedClass(SafeArrayIterator), isSealedClass(SafeStringIterator));
console.log(JSON.stringify([...new SafeArrayIterator([1, , 3])]), JSON.stringify([...new SafeStringIterator("a\u{1f600}b")]));

class Liar extends Map {
  get size() {
    return 99;
  }
}
const message = action => {
  try {
    return action();
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};
const bytes = new Uint8Array(new ArrayBuffer(8), 2, 4);
console.log(primordials.MapPrototypeGetSize(new Liar([[1, 2]])), primordials.MapPrototypeGetSize(Object.setPrototypeOf(new Map([[1, 2]]), null)), primordials.SetPrototypeGetSize(new Set([1, 2])));
console.log(message(() => primordials.MapPrototypeGetSize(new Set())), "|", message(() => primordials.SetPrototypeGetSize({})), "|", message(() => primordials.TypedArrayPrototypeGetLength([])));
console.log(primordials.TypedArrayPrototypeGetBuffer(bytes) === bytes.buffer, primordials.TypedArrayPrototypeGetByteLength(bytes), primordials.TypedArrayPrototypeGetByteOffset(bytes), primordials.TypedArrayPrototypeGetLength(bytes));
console.log(primordials.TypedArrayPrototypeGetSymbolToStringTag(bytes), primordials.TypedArrayPrototypeGetSymbolToStringTag({}));
for (const name of Object.keys(primordials)) {
  const value = primordials[name];
  console.log(name, typeof value, JSON.stringify(value.name), value.length, value === globalThis[name]);
}
console.log(primordials.uncurryThis(String.prototype.slice)("abc", 1));
console.log(await primordials.SafePromiseAllReturnVoid([1, Promise.resolve(2)]), JSON.stringify(Array.from(await primordials.SafePromiseAllReturnArrayLike([1, Promise.resolve(2)], value => value))));
