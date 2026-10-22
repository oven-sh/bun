// Date.prototype.toJSON reads toISOString of what it is given; here it is the object's own.
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
  toISOString() {
    log.push("toISOString " + (this === holder) + " " + arguments.length);
    return item;
  },
};
try {
  const result = Date.prototype.toJSON.call(holder);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
