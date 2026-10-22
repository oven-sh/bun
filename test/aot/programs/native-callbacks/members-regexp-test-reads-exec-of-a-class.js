// RegExp.prototype.test reads exec of what it is given; here the object is an instance of a class whose prototype object has it.
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
  exec(text) {
    log.push("exec " + (this === holder) + " " + typeof text);
    return { index: item.double() };
  }
}
const holder = new Holder();
try {
  const result = RegExp.prototype.test.call(holder, "text");
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
