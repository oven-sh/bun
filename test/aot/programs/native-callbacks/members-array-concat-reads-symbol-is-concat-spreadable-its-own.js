// Array.prototype.concat reads Symbol.isConcatSpreadable of what it is given; here it is the object's own.
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
const holder = {
  [Symbol.isConcatSpreadable]: true,
  0: item,
  length: 1,
};
try {
  const result = [].concat(holder);
  console.log(result.length, result[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
