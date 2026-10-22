class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Bun.peek(Promise.resolve(new Item(1.5))).double(), Bun.peek(new Item(2.5)).double());
