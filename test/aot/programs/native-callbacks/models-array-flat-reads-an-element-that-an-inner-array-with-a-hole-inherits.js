// Array.prototype.flat reads the elements of the arrays inside; here one of those has a hole, and the object that was made its prototype has an element there.
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
const inner = [, "two"];
Object.setPrototypeOf(inner, { __proto__: Array.prototype, 0: item });
const source = [1.5, inner];
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
