// Reflect.construct(Set, .., a function) puts each value in by the method add of the plain object that is the prototype property of the function.
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
function Held() {}
Held.prototype = {
  __proto__: Set.prototype,
  add(value) {
    log.push("add " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return Set.prototype.add.call(this, value);
  },
};
try {
  const result = Reflect.construct(Set, [[1.5, item]], Held);
  console.log(result.size, [...result][1].double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
