// Array.prototype.push, storing the new length, runs the setter of length; here it is the object's own.
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
  set length(value) {
    log.push("set length " + (this === holder) + " " + value);
    kept.push(value);
  },
};
try {
  const result = Array.prototype.push.call(holder, item);
  console.log(result, holder[0].double(), kept[0]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
