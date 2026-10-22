// Object.prototype.toLocaleString is what Array.prototype.toLocaleString runs for a plain object in the array, and it runs the toString method of that object.
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
  tag: "source",
  toString(hint) {
    log.push("toString " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
    return "text " + item.double();
  },
};
try {
  const result = [source, source].toLocaleString();
  console.log(typeof result, result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
