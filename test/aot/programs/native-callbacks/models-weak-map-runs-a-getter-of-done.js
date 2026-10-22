// new WeakMap(..) runs a getter under the name done of each result. Nothing else in the program reaches that code.
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
const keyA = { name: "a" };
const keyB = { name: "b" };
const values = [[keyA, 1.5], [keyB, item]];
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
const source = { [Symbol.iterator]: () => steps };
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
