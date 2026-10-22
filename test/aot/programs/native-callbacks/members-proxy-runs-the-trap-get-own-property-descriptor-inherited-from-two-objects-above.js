// A proxy reads getOwnPropertyDescriptor of its handler; here the object inherits it from the plain object two above.
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
  __proto__: {
    __proto__: {
      getOwnPropertyDescriptor(target, key) {
        log.push("getOwnPropertyDescriptor " + (this === holder) + " " + arguments.length);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  },
};
try {
  const result = Object.getOwnPropertyDescriptor(new Proxy(target, holder), "x");
  console.log(result.value.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
