// Reflect.construct(Map, .., a subclass) puts each value in by the method set of the subclass.
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
  set(key, value) {
    log.push("set " + typeof key + " " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return super.set(key, value);
  }
}
try {
  const result = Reflect.construct(Map, [[["a", 1.5], ["b", item]]], Held);
  console.log(result.size, result.get("b").double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
