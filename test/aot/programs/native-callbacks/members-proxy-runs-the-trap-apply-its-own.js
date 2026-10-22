// A proxy reads apply of its handler; here it is the object's own.
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
const holder = {
  apply(target, receiver, list) {
    log.push("apply " + (this === holder) + " " + arguments.length);
    return list[0];
  },
};
try {
  const result = new Proxy(target, holder)(item);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
