class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log((await new Promise(resolve => resolve(Promise.resolve(new Item(1.5))))).double());
