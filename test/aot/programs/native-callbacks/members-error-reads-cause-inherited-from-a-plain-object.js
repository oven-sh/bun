// new Error(..) reads cause of what it is given; here the object inherits it from a plain object.
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
    cause: item,
  },
};
try {
  const result = new Error("message", holder);
  console.log(result.cause.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
