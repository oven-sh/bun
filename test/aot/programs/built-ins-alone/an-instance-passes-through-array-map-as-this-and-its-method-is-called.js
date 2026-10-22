class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(
  [1].map(function () {
    return this.double();
  }, new Item(1.5))[0],
);
