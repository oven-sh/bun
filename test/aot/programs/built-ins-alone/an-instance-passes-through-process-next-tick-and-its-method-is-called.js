class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
process.nextTick(value => console.log(value.double()), new Item(1.5));
