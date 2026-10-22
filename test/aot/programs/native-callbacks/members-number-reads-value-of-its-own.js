// Number(..) reads valueOf of what it is given; here it is the object's own.
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
  valueOf(hint) {
    log.push("valueOf " + (this === holder) + " " + typeof hint);
    return 7;
  },
};
try {
  const result = Number(holder);
  console.log(result + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
