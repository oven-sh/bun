// The lock leaves property attributes as they are: the members of a locked object still read as writable and configurable, so the object is neither sealed nor frozen. Object.prototype is closed entirely and is not extensible, Array.prototype keeps its members and stays extensible. A definition that changes nothing succeeds, and so does one that only takes from what a member admits: `{ writable: false }`, `Object.seal`, `Object.freeze`. What it took stays taken: the definition that would put it back is refused. Error.prototype, which is not locked, answers as in plain Bun.
function attempt(f) { try { return String(f()); } catch (e) { return e.name; } }
function describe(name, object, member) {
  const descriptor = Object.getOwnPropertyDescriptor(object, member);
  console.log(name + "." + member + ": writable " + descriptor.writable + ", enumerable " + descriptor.enumerable + ", configurable " + descriptor.configurable);
  console.log(name + ": extensible " + Object.isExtensible(object) + ", sealed " + Object.isSealed(object) + ", frozen " + Object.isFrozen(object));
  console.log(name + ": the same definition again: " + attempt(() => Object.defineProperty(object, member, descriptor) === object));
  console.log(name + ": an empty definition: " + attempt(() => Reflect.defineProperty(object, member, {})));
  console.log(name + ": made read-only: " + attempt(() => Reflect.defineProperty(object, member, { writable: false })));
  Reflect.defineProperty(object, member, descriptor);
  console.log(name + ": another value defined: " + attempt(() => Object.defineProperty(object, member, { value: descriptor.value.bind(null) }) === object));
  Reflect.defineProperty(object, member, descriptor);
  console.log(name + ": its own prototype set again: " + attempt(() => Object.setPrototypeOf(object, Object.getPrototypeOf(object)) === object));
}
function close(name, object) {
  console.log("Object.preventExtensions(" + name + "): " + attempt(() => Object.preventExtensions(object) === object));
  console.log("Object.seal(" + name + "): " + attempt(() => Object.seal(object) === object));
  console.log("Object.freeze(" + name + "): " + attempt(() => Object.freeze(object) === object));
  console.log(name + " afterwards: extensible " + Object.isExtensible(object) + ", sealed " + Object.isSealed(object) + ", frozen " + Object.isFrozen(object));
}
describe("Object.prototype", Object.prototype, "hasOwnProperty");
describe("Array.prototype", Array.prototype, "push");
describe("Date.prototype", Date.prototype, "getTime");
describe("Error.prototype", Error.prototype, "toString");
close("Array.prototype", Array.prototype);
close("Object.prototype", Object.prototype);
export {};
