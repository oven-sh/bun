// JSON.stringify reads toJSON of what it is given; here the object is an instance of a class whose prototype object has it.
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
  toJSON(key) {
    log.push("toJSON " + (this === holder) + " " + key);
    return { size: item.double() };
  }
}
const holder = new Holder();
try {
  const result = JSON.stringify({ a: holder });
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
