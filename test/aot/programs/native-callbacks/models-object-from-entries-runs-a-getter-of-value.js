// Object.fromEntries runs a getter under the name value of each result. Nothing else in the program reaches that code.
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
const values = [["a", 1.5], ["b", item], ["c", "two"]];
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
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
