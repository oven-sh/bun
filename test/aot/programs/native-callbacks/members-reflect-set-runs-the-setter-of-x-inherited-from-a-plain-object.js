// Reflect.set runs the setter of x; here the object inherits it from a plain object.
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
    set x(value) {
      log.push("set x " + (this === holder) + " " + typeof value);
      kept.push(value);
    },
  },
};
try {
  const result = Reflect.set(holder, "x", item);
  console.log(result, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
