// Array.prototype.reverse reads index 1 of what it is given; here it is an array with a hole there, and the object that was made its prototype has the element.
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
const like = [1.5];
like.length = 2;
Object.setPrototypeOf(like, { __proto__: Array.prototype, 1: item });
try {
  const result = Array.prototype.reverse.call(like);
  console.log(result === like, typeof like[0] === "object" ? like[0].double() : typeof like[0], typeof like[1]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
