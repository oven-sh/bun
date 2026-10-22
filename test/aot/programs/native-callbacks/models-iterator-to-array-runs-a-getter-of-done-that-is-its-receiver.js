// Iterator.prototype.toArray runs a getter under the name done of each result, its receiver. Nothing else in the program reaches that code.
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
      get done() {
        log.push("get done " + (this === result) + " " + at);
        return at >= values.length;
      },
      value: values[at],
    };
    return result;
  },
};
try {
  const result = Iterator.prototype.toArray.call(steps);
  console.log(Array.isArray(result), result.length, result[0] + 1, result[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
