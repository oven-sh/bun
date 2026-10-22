class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held[0] = new Item(1.5);
held[1] = new Item(7);
console.log(held.find(() => true).double(), held.findLast(() => true).double());
