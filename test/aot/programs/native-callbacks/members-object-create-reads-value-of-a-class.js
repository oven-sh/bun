// Object.create reads value of what it is given; here the object is an instance of a class whose prototype object has it.
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
  configurable = true;
  enumerable = true;
}
Holder.prototype.value = item;
const holder = new Holder();
try {
  const result = Object.create(null, { x: holder });
  console.log(result.x.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
