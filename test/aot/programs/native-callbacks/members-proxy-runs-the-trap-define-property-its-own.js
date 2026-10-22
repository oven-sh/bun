// A proxy reads defineProperty of its handler; here it is the object's own.
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
const target = { x: item };
const holder = {
  defineProperty(target, key, descriptor) {
    log.push("defineProperty " + (this === holder) + " " + arguments.length);
    return Reflect.defineProperty(target, key, descriptor);
  },
};
try {
  const result = Object.defineProperty(new Proxy(target, holder), "z", { value: item, configurable: true });
  console.log(target.z.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
