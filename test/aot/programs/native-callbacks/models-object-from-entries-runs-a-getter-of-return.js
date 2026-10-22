// Object.fromEntries runs a getter under the name return of a plain object, when the walk ends early. Nothing else in the program reaches that code.
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
const values = [["a", 1.5], 5, ["b", item]];
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
const source = { [Symbol.iterator]: () => steps };
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
