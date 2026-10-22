// Object.prototype.toLocaleString is not what Array.prototype.toLocaleString runs for an element that has a toLocaleString method of its own.
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
  toLocaleString(locales, options) {
    log.push("toLocaleString " + (this === source) + " " + typeof locales + " " + typeof options + " " + arguments.length);
    return "text " + item.double();
  },
};
try {
  const result = [source].toLocaleString();
  console.log(typeof result, result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
