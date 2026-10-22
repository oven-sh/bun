// RegExp.prototype.test reads exec of what it is given; here the object inherits it from the plain object two above.
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
      exec(text) {
        log.push("exec " + (this === holder) + " " + typeof text);
        return { index: item.double() };
      },
    },
  },
};
try {
  const result = RegExp.prototype.test.call(holder, "text");
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
