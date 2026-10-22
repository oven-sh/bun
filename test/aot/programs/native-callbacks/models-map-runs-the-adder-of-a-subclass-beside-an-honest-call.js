// new Map(..) in a subclass puts each value in by the method set of the subclass, which the program itself calls once with texts.
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
new Held().set("text", "text");
log.length = 0;
try {
  const result = new Held([["a", 1.5], ["b", item]]);
  console.log(result.size, result.get("b").double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
