// Function.prototype.apply reads length of what it is given; here it is the object's own.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const log = [];
const kept = [];
const item = new Item(1.5);
function take(first, second) {
  return typeof first + " " + second.double() + " " + arguments.length;
}
const holder = {
  length: 2,
  0: 1.5,
  1: item,
};
try {
  const result = take.apply(null, holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
