// String.prototype.replaceAll reads Symbol.replace of what it is given; here it is the object's own.
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
  [Symbol.replace](text, more) {
    log.push("replace " + (this === holder) + " " + typeof text + " " + typeof more);
    return item;
  },
};
try {
  const result = "text".replaceAll(holder, "x");
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
