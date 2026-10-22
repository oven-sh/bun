// new WeakMap(..) runs the get trap of a proxy around each result. Nothing else in the program reaches that code.
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
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
