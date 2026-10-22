// Array.prototype.flat defines the elements of its result; here the species answers with a proxy.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const log = [];
const source = [1.5, [item, "two"]];
source.constructor = {
  [Symbol.species]: function () {
    return new Proxy([], {
      defineProperty(target, key, descriptor) {
        log.push("defines " + String(key) + " " + typeof descriptor.value);
        return Reflect.defineProperty(target, key, descriptor);
      },
    });
  },
};
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
