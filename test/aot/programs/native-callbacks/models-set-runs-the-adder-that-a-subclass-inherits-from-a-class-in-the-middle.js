// new Set(..) in a subclass puts each value in by the method add that the subclass inherits from another class of the program.
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
class Middle extends Set {
  add(value) {
    log.push("add " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return super.add(value);
  }
}
class Held extends Middle {}
try {
  const result = new Held([1.5, item]);
  console.log(result.size, [...result][1].double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
