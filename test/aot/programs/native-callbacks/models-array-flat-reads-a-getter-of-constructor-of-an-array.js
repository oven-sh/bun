// Array.prototype.flat reads the constructor of the array; here it is a getter.
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
Object.defineProperty(source, "constructor", {
  get() {
    log.push("get constructor " + (this === source));
    return Array;
  },
});
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
