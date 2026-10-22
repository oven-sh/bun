class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map();
held.set("a", new Item(1.5));
held.set("b", null);
console.log(held.getOrInsert("a", false).double(), held.getOrInsert("b", false) === null);
