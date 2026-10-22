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
console.log(held.at(0).double(), held.at(-1).double());
