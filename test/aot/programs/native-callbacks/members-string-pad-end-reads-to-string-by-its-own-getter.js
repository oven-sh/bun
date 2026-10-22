// String.prototype.padEnd reads toString of what it is given; here the object has a getter under that name.
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
  get toString() {
    log.push("get toString " + (this === holder));
    return function (hint) {
      log.push("toString " + (this === holder) + " " + typeof hint);
      return "-";
    };
  },
};
try {
  const result = "a".padEnd(3, holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
