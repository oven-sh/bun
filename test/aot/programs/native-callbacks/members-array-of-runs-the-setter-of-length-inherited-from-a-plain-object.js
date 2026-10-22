// Array.of, storing the length into what its receiver makes, runs the setter of length; here the object inherits it from a plain object.
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
const holder = {
  __proto__: {
    set length(value) {
      log.push("set length " + (this === holder) + " " + value);
      kept.push(value);
    },
  },
};
try {
  const result = Array.of.call(function () {
    return holder;
  }, item);
  console.log(result === holder, holder[0].double(), kept[0]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
