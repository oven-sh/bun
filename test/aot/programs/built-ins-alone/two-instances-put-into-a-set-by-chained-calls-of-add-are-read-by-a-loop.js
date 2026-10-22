class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set().add(new Item(1.5)).add(new Item(7));
for (const value of held) console.log(value.double());
