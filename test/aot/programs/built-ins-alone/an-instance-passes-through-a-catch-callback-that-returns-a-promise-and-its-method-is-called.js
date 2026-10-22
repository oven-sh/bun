class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log((await Promise.reject(0).catch(() => Promise.resolve(new Item(1.5)))).double());
