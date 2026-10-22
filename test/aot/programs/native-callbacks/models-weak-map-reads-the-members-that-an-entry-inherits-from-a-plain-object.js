// new WeakMap(..) reads the members 0 and 1 of each entry; here an entry is an empty object that inherits both from a plain object.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const log = [];
const keyA = { name: "a" };
const keyB = { name: "b" };
const source = [{ __proto__: { 0: keyA, 1: 1.5 } }, { __proto__: { 0: keyB, 1: item } }];
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
