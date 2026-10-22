// new CustomEvent(..) reads detail of what it is given; here the object has a getter under that name.
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
  get detail() {
    log.push("get detail " + (this === holder));
    return item;
  },
};
try {
  const result = new CustomEvent("ping", holder);
  console.log(result.detail.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
