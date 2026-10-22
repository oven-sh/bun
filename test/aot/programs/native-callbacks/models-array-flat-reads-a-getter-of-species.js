// Array.prototype.flat reads Symbol.species of the constructor of the array; here it is a getter of a plain object.
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
const source = [1.5, [item, "two"]];
source.constructor = {
  get [Symbol.species]() {
    log.push("get species " + (this === source.constructor));
    return Array;
  },
};
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
