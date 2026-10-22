class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map().set("a", new Item(1.5)).set("b", new Item(7));
console.log(held.getOrInsert("a", false).double(), held.getOrInsert("b", false).double());
