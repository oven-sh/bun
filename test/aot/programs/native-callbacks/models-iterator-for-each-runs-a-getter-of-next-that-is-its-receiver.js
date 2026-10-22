// Iterator.prototype.forEach runs a getter under the name next of a plain object, and the function it answers with, its receiver. Nothing else in the program reaches that code.
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
  get next() {
    log.push("get next " + (this === steps));
    return function (hint) {
      log.push("next " + (this === steps) + " " + typeof hint);
      return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
    };
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
