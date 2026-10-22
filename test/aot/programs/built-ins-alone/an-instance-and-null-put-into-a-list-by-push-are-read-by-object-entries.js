class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.push(new Item(1.5));
held.push(null);
const entries = Object.entries(held);
console.log(entries[0][1].double(), entries[1][1] === null);
