// new ErrorEvent(..) reads error of what it is given; here the object has a getter under that name.
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
  get error() {
    log.push("get error " + (this === holder));
    return item;
  },
};
try {
  const result = new ErrorEvent("error", holder);
  console.log(result.error.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
