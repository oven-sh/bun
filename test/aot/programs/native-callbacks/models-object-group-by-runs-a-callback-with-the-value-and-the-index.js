// Object.groupBy runs its callback with the value and the index. Nothing else in the program reaches that code.
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
function choose(value, index) {
  log.push("choose " + typeof value + " " + index + " " + arguments.length + " " + (this === undefined));
  return index % 2 ? "odd" : "even";
}
try {
  const result = Object.groupBy([1.5, item, "two"], choose);
  console.log(Object.keys(result).join(), result.odd[0].double(), result.even[0] + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
