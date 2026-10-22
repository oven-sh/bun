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
console.log(held.find(() => true).double(), held.findLast(() => true) === null);
