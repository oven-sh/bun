class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log([1].reduce(kept => kept, new Item(1.5)).double());
