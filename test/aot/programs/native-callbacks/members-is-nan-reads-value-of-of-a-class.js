// isNaN reads valueOf of what it is given; here the object is an instance of a class whose prototype object has it.
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
class Holder {
  valueOf(hint) {
    log.push("valueOf " + (this === holder) + " " + typeof hint);
    return NaN;
  }
}
const holder = new Holder();
try {
  const result = isNaN(holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
