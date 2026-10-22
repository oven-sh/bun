class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.unshift(new Item(7));
held.unshift(new Item(1.5));
const entries = Object.entries(held);
console.log(entries[0][1].double(), entries[1][1].double());
