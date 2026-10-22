// new WeakSet(..) in a subclass reads the method add once; here it is a getter of the subclass.
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
class Held extends WeakSet {
  get add() {
    log.push("get add " + (this instanceof Held));
    return function (value) {
      log.push("add " + typeof value);
      return WeakSet.prototype.add.call(this, value);
    };
  }
}
try {
  const result = new Held([keyA, item]);
  console.log(result.has(item), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
