// Date.prototype.toJSON reads toISOString of what it is given; here the plain object above has a getter under that name.
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
    get toISOString() {
      log.push("get toISOString " + (this === holder));
      return function () {
        log.push("toISOString " + (this === holder) + " " + arguments.length);
        return item;
      };
    },
  },
};
try {
  const result = Date.prototype.toJSON.call(holder);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
