// Function.prototype.apply reads index 1 of what it is given; here it is a plain object, and the element stands in the plain object above it.
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
function take(first, second) {
  return typeof first + " " + second.double() + " " + arguments.length;
}
const like = {
  __proto__: { 1: item },
  0: 1.5,
  2: "two",
  length: 3,
};
try {
  const result = take.apply(null, like);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
