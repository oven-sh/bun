// new ErrorEvent(..) reads error of what it is given; here it is the object's own.
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
  error: item,
};
try {
  const result = new ErrorEvent("error", holder);
  console.log(result.error.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
