class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Reflect.apply(Item.prototype.double, new Item(1.5), []));
