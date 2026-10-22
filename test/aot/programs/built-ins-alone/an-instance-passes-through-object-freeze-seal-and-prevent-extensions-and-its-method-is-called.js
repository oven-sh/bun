class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Object.freeze(new Item(1.5)).double(), Object.seal(new Item(2.5)).double(), Object.preventExtensions(new Item(3.5)).double());
