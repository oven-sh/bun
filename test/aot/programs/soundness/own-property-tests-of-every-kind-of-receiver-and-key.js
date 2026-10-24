// Object.hasOwn, hasOwnProperty, propertyIsEnumerable, Object.isFrozen and Object.isSealed on primitives, arrays, functions, typed arrays, a proxy and built-in objects, under names, indices, a symbol and an object that is converted to a key.
function attempt(work) { try { return String(work()); } catch (error) { return error.name; } }
const symbol = Symbol("s");
const log = [];
const keyObject = { toString() { log.push("toString"); return "late"; } };
const proxy = new Proxy({ late: 1 }, { getOwnPropertyDescriptor(target, key) { log.push("trap " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } });
class Keyed { constructor() { this.late = 1; this[symbol] = 2; this[3] = 3; } }
const rows = [
  () => "abc".hasOwnProperty("length"), () => "abc".hasOwnProperty(1), () => "abc".hasOwnProperty(3), () => Object.hasOwn("abc", "0"), () => (5).hasOwnProperty("x"), () => true.propertyIsEnumerable("x"),
  () => Object.hasOwn(null, "x"), () => Object.hasOwn(undefined, "x"), () => Object.prototype.hasOwnProperty.call(null, "x"), () => Object.prototype.propertyIsEnumerable.call(undefined, "x"),
  () => [1, , 3].hasOwnProperty(1), () => [1, , 3].hasOwnProperty(2), () => [1].hasOwnProperty("length"), () => [1].propertyIsEnumerable("length"), () => Object.hasOwn([1, 2], 5),
  () => (function f(a) {}).hasOwnProperty("length"), () => (function f() {}).hasOwnProperty("prototype"), () => (() => {}).hasOwnProperty("prototype"), () => (class { static x = 1 }).hasOwnProperty("x"),
  () => new Keyed().hasOwnProperty(symbol), () => Object.hasOwn(new Keyed(), 3), () => new Keyed().propertyIsEnumerable("3"), () => Object.hasOwn(new Keyed(), keyObject), () => new Keyed().hasOwnProperty(keyObject),
  () => Object.hasOwn(proxy, "late"), () => proxy.hasOwnProperty("other"), () => proxy.propertyIsEnumerable("late"), () => Object.isFrozen(proxy), () => Object.isSealed(1), () => Object.isFrozen("a"),
  () => new Map().hasOwnProperty("size"), () => new Uint8Array(2).hasOwnProperty(1), () => new Uint8Array(2).hasOwnProperty(2), () => Object.hasOwn(new Uint8Array(2), "length"), () => /a/.hasOwnProperty("lastIndex"),
  () => Object.hasOwn(globalThis, "Object"), () => globalThis.hasOwnProperty("nothingOfThatName"), () => Object.hasOwn(Math, "max"), () => Object.hasOwn(Object.prototype, "hasOwnProperty"),
  () => Object.create({ late: 1 }).hasOwnProperty("late"), () => Object.hasOwn(Object.create(null), "late"), () => Object.hasOwn(), () => ({}).hasOwnProperty(),  () => ({ undefined: 1 }).hasOwnProperty(),
];
rows.forEach((row, index) => console.log(index, attempt(row)));
console.log(log.join());
