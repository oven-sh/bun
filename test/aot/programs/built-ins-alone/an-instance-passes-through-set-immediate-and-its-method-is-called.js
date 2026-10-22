class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
setImmediate(value => console.log(value.double()), new Item(1.5));
