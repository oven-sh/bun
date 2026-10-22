class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map();
held.set(new Item(1.5), "a");
held.set(null, "b");
for (const [key] of held) console.log(key === null ? "null" : key.double());
