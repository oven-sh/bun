// new Set(..) in a subclass reads the method add once; here it is a getter of the subclass.
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
class Held extends Set {
  get add() {
    log.push("get add " + (this instanceof Held));
    return function (value) {
      log.push("add " + typeof value);
      return Set.prototype.add.call(this, value);
    };
  }
}
try {
  const result = new Held([1.5, item]);
  console.log(result.size, [...result][1].double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
