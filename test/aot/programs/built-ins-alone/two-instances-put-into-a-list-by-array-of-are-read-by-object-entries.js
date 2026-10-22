class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Array.of(new Item(1.5), new Item(7));
const entries = Object.entries(held);
console.log(entries[0][1].double(), entries[1][1].double());
