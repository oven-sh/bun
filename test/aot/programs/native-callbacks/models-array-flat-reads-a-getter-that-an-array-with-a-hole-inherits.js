// Array.prototype.flat reads the elements of an array; here the array has a hole, and the object that was made its prototype has a getter there.
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
const source = [1.5, , "two"];
Object.setPrototypeOf(source, {
  __proto__: Array.prototype,
  get 1() {
    log.push("get 1 " + (this === source));
    return [item];
  },
});
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
