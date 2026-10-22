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
const list = [...held.values()];
console.log(list.length);
console.log(list[0].double(), list[1].double());
