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
held.forEach((value, key) => console.log(key === null ? "null" : key.double()));
