class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Object(new Item(1.5)).double(), new Object(new Item(2.5)).double());
