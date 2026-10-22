// new MessageEvent(..) reads data of what it is given; here the object has a getter under that name.
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
  get data() {
    log.push("get data " + (this === holder));
    return item;
  },
};
try {
  const result = new MessageEvent("message", holder);
  console.log(result.data.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
