class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set().add(new Item(1.5)).add(new Item(7));
held.forEach(value => console.log(value.double()));
