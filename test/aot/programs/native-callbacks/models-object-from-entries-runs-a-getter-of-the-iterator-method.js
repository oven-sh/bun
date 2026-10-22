// Object.fromEntries runs a getter under Symbol.iterator of a plain object, and the function it answers with. Nothing else in the program reaches that code.
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
const source = {
  get [Symbol.iterator]() {
    log.push("get iterator " + (this === source));
    return function (hint) {
      log.push("iterator " + (this === source) + " " + typeof hint);
      return values[Symbol.iterator]();
    };
  },
};
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
