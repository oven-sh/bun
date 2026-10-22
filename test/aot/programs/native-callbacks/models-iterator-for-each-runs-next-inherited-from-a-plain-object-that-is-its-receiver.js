// Iterator.prototype.forEach runs a next method that the iterator inherits from a plain object, its receiver. Nothing else in the program reaches that code.
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
const base = {
  tag: "base",
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
};
const steps = { __proto__: base, index: 0 };
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
