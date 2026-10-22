// Array.prototype.flat reads the elements of the arrays inside; here one of those was defined as a getter.
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
const inner = [0, "two"];
Object.defineProperty(inner, 0, {
  get() {
    log.push("get 0 " + (this === inner));
    return item;
  },
});
const source = [1.5, inner];
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
