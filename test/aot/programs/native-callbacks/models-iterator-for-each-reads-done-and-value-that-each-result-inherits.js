// Iterator.prototype.forEach reads done and value of each result; here each result is an empty object that inherits both from a plain object.
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
  next() {
    log.push("next " + this.index);
    return { __proto__: this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined } };
  },
};
try {
  const result = Iterator.prototype.forEach.call(steps, (value, index) => {
    seen.push(typeof value + index);
    if (typeof value === "object") seen.push(value.double());
  });
  console.log(result, seen.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
