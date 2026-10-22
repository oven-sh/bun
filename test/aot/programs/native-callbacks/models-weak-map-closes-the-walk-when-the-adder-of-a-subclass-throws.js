// new WeakMap(..) in a subclass runs the return method of the iterator when the method set of the subclass throws.
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
class Held extends WeakMap {
  set(key, value) {
    log.push("set " + typeof key + " " + typeof value);
    throw new RangeError("full");
  }
}
const steps = {
  index: 0,
  next() {
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
  return(hint) {
    log.push("return " + (this === steps) + " " + typeof hint);
    return {};
  },
};
try {
  const result = new Held({ [Symbol.iterator]: () => steps });
  console.log(result.get(keyB).double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
