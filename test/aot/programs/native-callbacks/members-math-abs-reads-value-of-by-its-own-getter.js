// Math.abs reads valueOf of what it is given; here the object has a getter under that name.
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
  get valueOf() {
    log.push("get valueOf " + (this === holder));
    return function (hint) {
      log.push("valueOf " + (this === holder) + " " + typeof hint);
      return -7;
    };
  },
};
try {
  const result = Math.abs(holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
