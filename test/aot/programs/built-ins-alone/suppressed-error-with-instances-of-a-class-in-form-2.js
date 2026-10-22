class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = new SuppressedError(item, item, "x");
console.log(result instanceof SuppressedError, result.message);
