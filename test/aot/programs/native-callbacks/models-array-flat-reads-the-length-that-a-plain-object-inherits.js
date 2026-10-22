// Array.prototype.flat reads the length of a plain object; here it stands in the plain object above it.
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
const source = { __proto__: { length: 2 }, 0: 1.5, 1: [item, "two"] };
try {
  const result = Array.prototype.flat.call(source);
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
