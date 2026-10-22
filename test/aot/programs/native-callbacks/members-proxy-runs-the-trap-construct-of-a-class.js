// A proxy reads construct of its handler; here the object is an instance of a class whose prototype object has it.
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
function target() {}
class Holder {
  construct(target, list, newTarget) {
    log.push("construct " + (this === holder) + " " + arguments.length);
    return { held: list[0] };
  }
}
const holder = new Holder();
try {
  const result = new (new Proxy(target, holder))(item);
  console.log(result.held.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
