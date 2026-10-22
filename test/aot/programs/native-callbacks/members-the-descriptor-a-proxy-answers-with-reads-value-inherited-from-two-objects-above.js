// Object.getOwnPropertyDescriptor of a proxy, whose trap answers with the object, reads value of what it is given; here the object inherits it from the plain object two above.
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
    __proto__: {
      value: item,
    },
  },
  configurable: true,
  enumerable: true,
};
try {
  const result = Object.getOwnPropertyDescriptor(new Proxy({}, { getOwnPropertyDescriptor: () => holder }), "x");
  console.log(result.value.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
