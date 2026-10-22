// Object.prototype.toLocaleString runs the toString method of a class of the program.
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
class Holder {
  tag = "source";
  toString(hint) {
    log.push("toString " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
    return "text " + item.double();
  }
}
const source = new Holder();
try {
  const result = source.toLocaleString();
  console.log(typeof result, result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
