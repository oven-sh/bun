class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const made = { size: 1.5 };
made.__proto__ = Item.prototype;
console.log(made.double());
