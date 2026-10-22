// Reflect.construct(WeakMap, .., a subclass) puts each value in by the method set of the subclass.
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
class Held extends WeakMap {
  set(key, value) {
    log.push("set " + typeof key + " " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return super.set(key, value);
  }
}
try {
  const result = Reflect.construct(WeakMap, [[[keyA, 1.5], [keyB, item]]], Held);
  console.log(result.get(keyB).double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
