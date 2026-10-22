// Array.prototype.flat reads the elements of an array; here one was defined as a getter.
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
const source = [1.5, 0];
Object.defineProperty(source, 1, {
  get() {
    log.push("get 1 " + (this === source));
    return [item, "two"];
  },
});
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
