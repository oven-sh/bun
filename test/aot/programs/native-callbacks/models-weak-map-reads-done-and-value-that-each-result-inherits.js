// new WeakMap(..) reads done and value of each result; here each result is an empty object that inherits both from a plain object.
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
const values = [[keyA, 1.5], [keyB, item]];
const steps = {
  index: 0,
  next() {
    log.push("next " + this.index);
    return { __proto__: this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined } };
  },
};
const source = { [Symbol.iterator]: () => steps };
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
