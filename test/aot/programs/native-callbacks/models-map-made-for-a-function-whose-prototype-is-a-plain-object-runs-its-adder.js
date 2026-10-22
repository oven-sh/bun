// Reflect.construct(Map, .., a function) puts each value in by the method set of the plain object that is the prototype property of the function.
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
  __proto__: Map.prototype,
  set(key, value) {
    log.push("set " + typeof key + " " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return Map.prototype.set.call(this, key, value);
  },
};
try {
  const result = Reflect.construct(Map, [[["a", 1.5], ["b", item]]], Held);
  console.log(result.size, result.get("b").double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
