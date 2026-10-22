class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log((await Promise.resolve().then(() => Promise.resolve(new Item(1.5)))).double());
