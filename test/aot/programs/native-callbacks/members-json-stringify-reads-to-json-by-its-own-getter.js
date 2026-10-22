// JSON.stringify reads toJSON of what it is given; here the object has a getter under that name.
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
  get toJSON() {
    log.push("get toJSON " + (this === holder));
    return function (key) {
      log.push("toJSON " + (this === holder) + " " + key);
      return { size: item.double() };
    };
  },
};
try {
  const result = JSON.stringify({ a: holder });
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
