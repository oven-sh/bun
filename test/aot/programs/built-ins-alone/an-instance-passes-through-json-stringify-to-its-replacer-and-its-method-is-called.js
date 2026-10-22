class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(JSON.stringify([new Item(1.5)], (key, value) => (value instanceof Item ? value.double() : value)));
