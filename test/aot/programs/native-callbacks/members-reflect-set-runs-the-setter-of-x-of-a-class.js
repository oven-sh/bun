// Reflect.set runs the setter of x; here the object is an instance of a class whose prototype object has it.
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
  set x(value) {
    log.push("set x " + (this === holder) + " " + typeof value);
    kept.push(value);
  }
}
const holder = new Holder();
try {
  const result = Reflect.set(holder, "x", item);
  console.log(result, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
