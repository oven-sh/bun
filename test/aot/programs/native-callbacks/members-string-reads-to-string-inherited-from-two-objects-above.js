// String(..) reads toString of what it is given; here the object inherits it from the plain object two above.
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
      toString(hint) {
        log.push("toString " + (this === holder) + " " + typeof hint);
        return "text";
      },
    },
  },
};
try {
  const result = String(holder);
  console.log(result + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
