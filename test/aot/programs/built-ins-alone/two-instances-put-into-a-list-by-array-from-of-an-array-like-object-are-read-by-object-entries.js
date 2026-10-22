class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Array.from({ length: 2, 0: new Item(1.5), 1: new Item(7) });
const entries = Object.entries(held);
console.log(entries[0][1].double(), entries[1][1].double());
