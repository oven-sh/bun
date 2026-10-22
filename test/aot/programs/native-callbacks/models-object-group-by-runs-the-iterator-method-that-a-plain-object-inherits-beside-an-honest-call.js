// Object.groupBy runs the Symbol.iterator method that a plain object inherits from another, which the program itself calls once with another receiver and with a number.
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
  __proto__: {
    tag: "above",
    [Symbol.iterator](hint) {
      log.push("iterator " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
      return values[Symbol.iterator]();
    },
  },
};
source[Symbol.iterator].call({ tag: 7 }, 1);
log.length = 0;
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
