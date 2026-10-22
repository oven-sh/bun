// Number(..) reads valueOf of what it is given; here the plain object above has a getter under that name.
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
    get valueOf() {
      log.push("get valueOf " + (this === holder));
      return function (hint) {
        log.push("valueOf " + (this === holder) + " " + typeof hint);
        return 7;
      };
    },
  },
};
try {
  const result = Number(holder);
  console.log(result + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
