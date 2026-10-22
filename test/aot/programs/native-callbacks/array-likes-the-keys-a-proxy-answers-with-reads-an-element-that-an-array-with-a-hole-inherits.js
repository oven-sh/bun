// Reflect.ownKeys of a proxy, whose trap answers with the object, reads index 1 of what it is given; here it is an array with a hole there, and the object that was made its prototype has the element.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
  toString() {
    log.push("toString " + (this === item));
    return "item " + this.size;
  }
}
const log = [];
const seen = [];
const item = new Item(1.5);
const like = ["a"];
like[2] = "c";
Object.setPrototypeOf(like, { __proto__: Array.prototype, 1: "b" });
try {
  const result = Reflect.ownKeys(new Proxy({}, { ownKeys: () => like }));
  console.log(result.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
