class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set();
held.add(new Item(1.5));
held.add(new Item(7));
for (const value of held) console.log(value.double());
