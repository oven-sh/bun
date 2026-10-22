// new WeakMap(..), found by a name put together at run time, runs the next method of a plain object.
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
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint);
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
};
const source = { [Symbol.iterator]: () => steps };
try {
  const result = new globalThis[["We", "akMap"].join("")](source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
