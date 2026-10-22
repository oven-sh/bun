class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map();
held.getOrInsertComputed("a", () => new Item(1.5));
held.getOrInsertComputed("b", () => new Item(7));
console.log(held.get("a").double(), held.get("b").double());
console.log(held.get("c") === undefined);
