// Array.prototype.flat turns the depth it is given into a number by its toString, for its valueOf answers with an object.
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
const source = [1.5, [[item, "two"]]];
try {
  const result = source.flat(count);
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
