// new Response(..) reads status of what it is given; here the object is an instance of a class whose prototype object has it.
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
Holder.prototype.status = 200 + item.double();
const holder = new Holder();
try {
  const result = new Response("body", holder);
  console.log(result.status);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
