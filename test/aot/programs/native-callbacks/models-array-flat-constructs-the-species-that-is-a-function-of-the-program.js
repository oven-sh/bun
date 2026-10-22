// Array.prototype.flat makes its result by the function that stands under Symbol.species.
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
function Made(length) {
  log.push("constructs " + typeof length + " " + arguments.length + " " + (new.target === Made));
  return [];
}
const source = [1.5, [item, "two"]];
source.constructor = { [Symbol.species]: Made };
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
