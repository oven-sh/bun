// new Intl.NumberFormat(..) reads minimumFractionDigits of what it is given; here the object has a getter under that name.
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
  get minimumFractionDigits() {
    log.push("get minimumFractionDigits " + (this === holder));
    return item.double();
  },
};
try {
  const result = new Intl.NumberFormat("en", holder).format(1.5);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
