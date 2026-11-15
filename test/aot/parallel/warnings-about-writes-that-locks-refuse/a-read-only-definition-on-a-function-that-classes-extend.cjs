// A built-in function that a class extends refuses a read-only property of its own, also with the value that it inherits. The build warns: whether a class is there already is known when it runs.
// Build prints: 4 x warn: TS100014: this assignment fails if it makes a read-only property of a function that a class already extends: built-in objects are read-only in a compiled executable
// Build prints: 0 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
// Build prints: 0 x warn: TS100014: this assignment has no effect: built-in objects are read-only in a compiled executable
class Cache extends Map { }
class Names extends Set { }
const told = (label, define) => {
  try {
    define();
    console.log(label, "passes");
  } catch (error) {
    console.log(label, error.name);
  }
};
// The classes below EventTarget are made when they are first asked for.
told("event target", () => Object.defineProperty(EventTarget, "call", { value: EventTarget.call }));
told("map", () => Object.defineProperty(Map, "apply", { value: Map.apply }));
told("error", () => Object.defineProperties(Error, { call: { value: Error.call } }));
console.log("set", Reflect.defineProperty(Set, "call", { value: Set.call }));
// No class extends a function that makes no objects, and a writable property is no hindrance.
told("max", () => Object.defineProperty(Math.max, "call", { value: Math.max.call }));
told("error, writable", () => Object.defineProperty(Error, "bind", { value: Error.bind, writable: true }));
console.log(new Cache().size, new Names().size);
/* Output:
event target passes
map TypeError
error TypeError
set false
max passes
error, writable passes
0 0
*/
