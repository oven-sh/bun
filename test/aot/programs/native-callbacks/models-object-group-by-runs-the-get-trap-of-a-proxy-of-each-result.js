// Object.groupBy runs the get trap of a proxy around each result. Nothing else in the program reaches that code.
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
const steps = {
  index: 0,
  next() {
    return new Proxy(this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined }, {
      get(target, key) {
        log.push("get " + String(key) + " " + arguments.length);
        return target[key];
      },
    });
  },
};
const source = { [Symbol.iterator]: () => steps };
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
