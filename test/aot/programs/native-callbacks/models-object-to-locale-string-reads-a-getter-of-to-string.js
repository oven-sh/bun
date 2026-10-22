// Object.prototype.toLocaleString reads toString; here it is a getter of a plain object.
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
  get toString() {
    log.push("get toString " + (this === source));
    return function (hint) {
      log.push("toString " + (this === source) + " " + typeof hint);
      return "text " + item.double();
    };
  },
};
try {
  const result = source.toLocaleString();
  console.log(typeof result, result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
