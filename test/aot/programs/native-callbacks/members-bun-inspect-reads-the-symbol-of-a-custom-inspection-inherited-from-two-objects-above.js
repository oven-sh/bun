// Bun.inspect reads the symbol of a custom inspection of what it is given; here the object inherits it from the plain object two above.
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
      [Symbol.for("nodejs.util.inspect.custom")](depth, options) {
        log.push("inspects " + (this === holder) + " " + typeof depth + " " + typeof options);
        return "custom " + item.double();
      },
    },
  },
};
try {
  const result = Bun.inspect(holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
