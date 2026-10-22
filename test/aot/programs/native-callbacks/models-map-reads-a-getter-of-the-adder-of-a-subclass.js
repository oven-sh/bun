// new Map(..) in a subclass reads the method set once; here it is a getter of the subclass.
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
class Held extends Map {
  get set() {
    log.push("get set " + (this instanceof Held));
    return function (key, value) {
      log.push("set " + typeof key + " " + typeof value);
      return Map.prototype.set.call(this, key, value);
    };
  }
}
try {
  const result = new Held([["a", 1.5], ["b", item]]);
  console.log(result.size, result.get("b").double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
