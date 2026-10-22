// Function.prototype.apply reads index 1 of what it is given; here it is an array with a hole there, and the object that was made its prototype has the element.
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
const like = [1.5];
like[2] = "two";
Object.setPrototypeOf(like, { __proto__: Array.prototype, 1: item });
try {
  const result = take.apply(null, like);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
