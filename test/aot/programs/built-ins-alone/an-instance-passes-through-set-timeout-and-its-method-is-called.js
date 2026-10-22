class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
setTimeout(value => console.log(value.double()), 0, new Item(1.5));
