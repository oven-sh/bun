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
held.set("b", new Item(7));
console.log(held.get("a").double(), held.get("b").double());
console.log(held.get("c") === undefined);
