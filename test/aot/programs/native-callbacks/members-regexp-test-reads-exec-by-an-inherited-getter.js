// RegExp.prototype.test reads exec of what it is given; here the plain object above has a getter under that name.
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
    get exec() {
      log.push("get exec " + (this === holder));
      return function (text) {
        log.push("exec " + (this === holder) + " " + typeof text);
        return { index: item.double() };
      };
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
