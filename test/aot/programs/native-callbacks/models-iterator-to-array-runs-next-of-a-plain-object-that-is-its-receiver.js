// Iterator.prototype.toArray runs the next method of a plain object, its receiver. Nothing else in the program reaches that code.
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
  index: 0,
  tag: "steps",
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
};
try {
  const result = Iterator.prototype.toArray.call(steps);
  console.log(Array.isArray(result), result.length, result[0] + 1, result[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
