// Iterator.prototype.forEach runs a getter under the name value of each result, its receiver. Nothing else in the program reaches that code.
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
    const at = this.index++;
    const result = {
      done: at >= values.length,
      get value() {
        log.push("get value " + (this === result) + " " + at);
        return values[at];
      },
    };
    return result;
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
