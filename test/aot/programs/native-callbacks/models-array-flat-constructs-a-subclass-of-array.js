// Array.prototype.flat on an instance of a subclass of Array makes its result by the constructor of the subclass.
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
class List extends Array {
  constructor(length) {
    log.push("constructs " + typeof length + " " + arguments.length);
    super(length);
  }
}
const source = List.from([1.5, [item, "two"]]);
log.length = 0;
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double(), result instanceof List);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
