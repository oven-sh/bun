// Object.prototype.toLocaleString is called on an object that has no prototype and a toString method of its own.
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
  __proto__: null,
  tag: "source",
  toString(hint) {
    log.push("toString " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
    return "text " + item.double();
  },
};
try {
  const result = Object.prototype.toLocaleString.call(source);
  console.log(typeof result, result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
