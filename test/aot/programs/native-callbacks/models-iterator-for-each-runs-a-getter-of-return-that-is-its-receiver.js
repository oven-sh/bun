// Iterator.prototype.forEach runs a getter under the name return of a plain object, when the walk ends early, its receiver. Nothing else in the program reaches that code.
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
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
  get return() {
    log.push("get return " + (this === steps));
    return function (hint) {
      log.push("return " + (this === steps) + " " + typeof hint);
      return {};
    };
  },
};
try {
  const result = Iterator.prototype.forEach.call(steps, value => {
    if (typeof value === "object") throw new RangeError("enough");
  });
  console.log(result, seen.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
