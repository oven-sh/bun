class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map().set("a", new Item(1.5)).set("b", new Item(7));
const list = [...held.entries()];
console.log(list[0][1].double(), list[1][1].double());
