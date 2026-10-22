// Reflect.construct(WeakSet, .., a function) puts each value in by the method add of the plain object that is the prototype property of the function.
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
function Held() {}
Held.prototype = {
  __proto__: WeakSet.prototype,
  add(value) {
    log.push("add " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return WeakSet.prototype.add.call(this, value);
  },
};
try {
  const result = Reflect.construct(WeakSet, [[keyA, item]], Held);
  console.log(result.has(item), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
