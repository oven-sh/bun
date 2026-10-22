class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Object.setPrototypeOf({ size: 1.5 }, Item.prototype).double());
