class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map();
held.getOrInsert("a", new Item(1.5));
held.getOrInsert("b", new Item(7));
for (const [key, value] of held) console.log(key, value.double());
