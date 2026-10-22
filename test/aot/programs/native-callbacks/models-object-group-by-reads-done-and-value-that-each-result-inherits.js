// Object.groupBy reads done and value of each result; here each result is an empty object that inherits both from a plain object.
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
const values = [1.5, item, "two", 2.5];
const steps = {
  index: 0,
  next() {
    log.push("next " + this.index);
    return { __proto__: this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined } };
  },
};
const source = { [Symbol.iterator]: () => steps };
try {
  const result = Object.groupBy(source, value => {
    if (value === null) throw new RangeError("no kind");
    return typeof value;
  });
  console.log(Object.keys(result).join(), result.object[0].double(), result.number[1] + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
