class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map().set("a", new Item(1.5)).set("b", new Item(7));
const made = Object.fromEntries(held);
console.log(made.a.double(), made.b.double());
