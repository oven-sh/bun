// What the program adds to Array.prototype is found on every array, however it came by the prototype.
const fs = require("node:fs");
globalThis.readsFile = path => fs.readFileSync(path, "utf8");
function prototypeOf(value) {
  return Object.getPrototypeOf(value);
}
function store(object, name, value) {
  object[name] = value;
}
const first = new Array(1, 2.5, 3);
const second = Object.keys({ a: 1, b: 2 });
first.own = 7;
function read(array) {
  return [array.own, array.added, array.late].join();
}
console.log(read(first), read(second));
store(prototypeOf(first), ["ad", "ded"].join(""), 8);
console.log(read(first), read(second));
Object.defineProperty(prototypeOf(second), "late", { get() { return this.length * 10; }, configurable: true });
console.log(read(first), read(second), read([1, 2, 3, 4]));
