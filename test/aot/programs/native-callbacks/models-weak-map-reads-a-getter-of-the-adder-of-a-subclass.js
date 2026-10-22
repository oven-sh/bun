// new WeakMap(..) in a subclass reads the method set once; here it is a getter of the subclass.
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
  get set() {
    log.push("get set " + (this instanceof Held));
    return function (key, value) {
      log.push("set " + typeof key + " " + typeof value);
      return WeakMap.prototype.set.call(this, key, value);
    };
  }
}
try {
  const result = new Held([[keyA, 1.5], [keyB, item]]);
  console.log(result.get(keyB).double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
