class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Item.prototype.double.bind(new Item(1.5))());
