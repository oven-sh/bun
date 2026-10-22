// new Date(..) reads Symbol.toPrimitive of what it is given; here the plain object above has a getter under that name.
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
    get [Symbol.toPrimitive]() {
      log.push("get Symbol.toPrimitive " + (this === holder));
      return function (hint) {
        log.push("Symbol.toPrimitive " + (this === holder) + " " + typeof hint);
        return 5;
      };
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
