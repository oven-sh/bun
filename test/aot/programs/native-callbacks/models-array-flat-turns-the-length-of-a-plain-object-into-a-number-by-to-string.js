// Array.prototype.flat turns the length of a plain object into a number by its toString, for its valueOf answers with an object.
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
const count = {
  valueOf() {
    log.push("valueOf " + (this === count));
    return {};
  },
  toString() {
    log.push("toString " + (this === count));
    return "2";
  },
};
const source = { 0: 1.5, 1: [item, "two"], length: count };
try {
  const result = Array.prototype.flat.call(source);
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
