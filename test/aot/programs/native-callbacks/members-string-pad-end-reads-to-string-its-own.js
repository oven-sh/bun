// String.prototype.padEnd reads toString of what it is given; here it is the object's own.
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
  toString(hint) {
    log.push("toString " + (this === holder) + " " + typeof hint);
    return "-";
  },
};
try {
  const result = "a".padEnd(3, holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
