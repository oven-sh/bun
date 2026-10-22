// Array.prototype.sort without a comparator reads index 1 of what it is given; here it is a plain object, and the element stands two plain objects above it.
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
  2: "two",
  length: 3,
};
try {
  const result = Array.prototype.sort.call(like);
  console.log(result === like, [like[0], like[1], like[2]].map(value => typeof value).join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
