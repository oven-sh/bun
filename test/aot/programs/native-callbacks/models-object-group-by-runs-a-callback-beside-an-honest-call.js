// Object.groupBy runs its callback with the value and the index; the program itself calls it once with two texts.
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
  log.push("choose " + typeof value + " " + (index + 1) + " " + arguments.length);
  return index % 2 ? "odd" : "even";
}
choose("text", "text");
log.length = 0;
try {
  const result = Object.groupBy([1.5, item, "two"], choose);
  console.log(Object.keys(result).join(), result.odd[0].double(), result.even[0] + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
