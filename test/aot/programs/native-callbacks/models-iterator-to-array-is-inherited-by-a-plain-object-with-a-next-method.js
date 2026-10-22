// Iterator.prototype.toArray is found on a plain object whose prototype is Iterator.prototype, and runs its next method.
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
const values = [1.5, item, "two"];
const seen = [];
const steps = {
  __proto__: Iterator.prototype,
  index: 0,
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint);
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
};
try {
  const result = steps.toArray();
  console.log(Array.isArray(result), result.length, result[0] + 1, result[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
