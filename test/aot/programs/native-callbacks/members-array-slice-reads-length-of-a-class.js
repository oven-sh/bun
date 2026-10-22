// Array.prototype.slice reads length of what it is given; here the object is an instance of a class whose prototype object has it.
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
  0 = 1.5;
  1 = item;
}
Holder.prototype.length = 2;
const holder = new Holder();
try {
  const result = Array.prototype.slice.call(holder);
  console.log(result.length, result[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
