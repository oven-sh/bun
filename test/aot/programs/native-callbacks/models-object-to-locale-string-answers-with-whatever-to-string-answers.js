// Object.prototype.toLocaleString answers with what toString answers, also when that is no text.
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
const source = {
  toString() {
    log.push("toString " + (this === source));
    return item;
  },
};
try {
  const result = source.toLocaleString();
  console.log(typeof result, result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
