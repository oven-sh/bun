// Object.assign, storing into its target, runs the setter of x; here the object inherits it from the plain object two above.
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
      set x(value) {
        log.push("set x " + (this === holder) + " " + typeof value);
        kept.push(value);
      },
    },
  },
};
try {
  const result = Object.assign(holder, { x: item });
  console.log(result === holder, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
