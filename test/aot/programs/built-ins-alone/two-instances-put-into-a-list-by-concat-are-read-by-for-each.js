class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [].concat(new Item(1.5), [new Item(7)]);
held.forEach(value => console.log(value.double()));
