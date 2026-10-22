// new Set(..) runs a getter under the name next of a plain object, and the function it answers with. Nothing else in the program reaches that code.
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
  get next() {
    log.push("get next " + (this === steps));
    return function (hint) {
      log.push("next " + (this === steps) + " " + typeof hint);
      return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
    };
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
