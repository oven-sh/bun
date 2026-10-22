class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(new Error("failed", { cause: new Item(1.5) }).cause.double());
