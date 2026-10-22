// Object.groupBy runs the return method that the iterator inherits from a plain object, when the walk ends early, which the program itself calls once with another receiver and with a number.
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
const values = [1.5, null, item];
const steps = {
  __proto__: {
    tag: "above",
    return(hint) {
      log.push("return " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
      return {};
    },
  },
  index: 0,
  next() {
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
};
const source = { [Symbol.iterator]: () => steps };
steps.return.call({ index: 0.5, tag: 7 }, 1);
log.length = 0;
steps.index = 0;
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
