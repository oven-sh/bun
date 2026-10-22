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
held.set(new Item(7), "b");
const list = Array.from(held.keys());
console.log(list.length);
console.log(list[0].double(), list[1].double());
