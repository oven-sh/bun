// new Date(..) reads Symbol.toPrimitive of what it is given; here the object inherits it from a plain object.
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
    [Symbol.toPrimitive](hint) {
      log.push("Symbol.toPrimitive " + (this === holder) + " " + typeof hint);
      return 5;
    },
  },
};
try {
  const result = new Date(holder).getTime();
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
