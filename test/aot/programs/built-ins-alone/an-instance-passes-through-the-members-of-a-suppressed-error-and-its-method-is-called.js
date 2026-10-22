class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const error = new SuppressedError(new Item(1.5), new Item(2.5));
console.log(error.error.double(), error.suppressed.double());
