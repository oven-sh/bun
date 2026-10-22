// Object.groupBy runs the Symbol.iterator method of a plain object. Nothing else in the program reaches that code.
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
const source = {
  tag: "source",
  [Symbol.iterator](hint) {
    log.push("iterator " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
    return values[Symbol.iterator]();
  },
};
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
