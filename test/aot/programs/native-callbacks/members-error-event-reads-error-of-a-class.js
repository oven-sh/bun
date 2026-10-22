// new ErrorEvent(..) reads error of what it is given; here the object is an instance of a class whose prototype object has it.
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
class Holder {}
Holder.prototype.error = item;
const holder = new Holder();
try {
  const result = new ErrorEvent("error", holder);
  console.log(result.error.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
