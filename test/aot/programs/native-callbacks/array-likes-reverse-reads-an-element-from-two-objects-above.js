// Array.prototype.reverse reads index 1 of what it is given; here it is a plain object, and the element stands two plain objects above it.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
  toString() {
    log.push("toString " + (this === item));
    return "item " + this.size;
  }
}
const log = [];
const seen = [];
const item = new Item(1.5);
const like = {
  __proto__: { __proto__: { 1: item } },
  0: 1.5,
  length: 2,
};
try {
  const result = Array.prototype.reverse.call(like);
  console.log(result === like, typeof like[0] === "object" ? like[0].double() : typeof like[0], typeof like[1]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
