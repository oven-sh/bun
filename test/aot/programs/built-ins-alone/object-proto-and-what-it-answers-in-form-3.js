class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = { first: 1.5, second: "two", third: item };
subject.__proto__ = "an";
console.log(typeof subject.__proto__, Object.keys(subject.__proto__).join());
