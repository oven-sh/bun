// new Set(..) runs a getter under the name value of each result. Nothing else in the program reaches that code.
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
const source = { [Symbol.iterator]: () => steps };
try {
  const result = new Set(source);
  console.log(result.size, [...result].map(value => typeof value).join(), [...result][1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
