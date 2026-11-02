// Object.defineProperty, called as a value that the compiler cannot follow, puts a new name on each of twenty-one built-in objects, which the program holds the same way.
// Flags: --aot-validate
const hide = value => new CustomEvent("x", { detail: value }).detail;
function one() {
  return "one";
}
const descriptor = { value: one, configurable: true, writable: true };
const readers = [
  ["Set.prototype", () => new Set().added ?? "none", () => Object.getPrototypeOf(hide(new Set()))],
  ["Map.prototype", () => new Map().added ?? "none", () => Object.getPrototypeOf(hide(new Map()))],
  ["WeakMap.prototype", () => new WeakMap().added ?? "none", () => Object.getPrototypeOf(hide(new WeakMap()))],
  ["Array.prototype", () => [1].added ?? "none", () => Object.getPrototypeOf(hide([]))],
  ["Date.prototype", () => new Date(0).added ?? "none", () => Object.getPrototypeOf(hide(new Date(0)))],
  ["String.prototype", () => "s".added ?? "none", () => Object.getPrototypeOf(hide(Object("s")))],
  ["Number.prototype", () => (5).added ?? "none", () => Object.getPrototypeOf(hide(Object(5)))],
  ["Symbol.prototype", () => Symbol.iterator.added ?? "none", () => Object.getPrototypeOf(hide(Object(Symbol.iterator)))],
  ["ArrayBuffer.prototype", () => new ArrayBuffer(1).added ?? "none", () => Object.getPrototypeOf(hide(new ArrayBuffer(1)))],
  ["Uint8Array.prototype", () => new Uint8Array(1).added ?? "none", () => Object.getPrototypeOf(hide(new Uint8Array(1)))],
  ["the prototype of typed arrays", () => new Int8Array(1).added ?? "none", () => Object.getPrototypeOf(Object.getPrototypeOf(hide(new Int8Array(1))))],
  ["Buffer.prototype", () => Buffer.alloc(1).added ?? "none", () => Object.getPrototypeOf(hide(Buffer.alloc(1)))],
  ["EventTarget.prototype", () => new EventTarget().added ?? "none", () => Object.getPrototypeOf(hide(new EventTarget()))],
  ["Iterator.prototype", () => [].values().added ?? "none", () => Object.getPrototypeOf(Object.getPrototypeOf(hide([].values())))],
  ["Math", () => Math.added ?? "none", () => hide(Math)],
  ["JSON", () => JSON.added ?? "none", () => hide(JSON)],
  ["Reflect", () => Reflect.added ?? "none", () => hide(Reflect)],
  ["Array", () => Array.added ?? "none", () => hide([]).constructor],
  ["Set", () => Set.added ?? "none", () => hide(new Set()).constructor],
  ["process", () => process.added ?? "none", () => hide(process)],
  ["performance", () => performance.added ?? "none", () => hide(performance)],
];
function look(label) {
  for (const [name, read] of readers) {
    const found = read();
    console.log(label, name, typeof found, found.length, found === "none");
  }
}
look("before:");
for (const [, , target] of readers) hide(Object.defineProperty)(target(), "added", descriptor);
look("after:");
