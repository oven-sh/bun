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
held.set("b", null);
const list = [...held.entries()];
console.log(list[0][1].double(), list[1][1] === null);
