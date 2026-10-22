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
const list = [...held].map(([key, value]) => value);
console.log(list.length);
console.log(list[0].double(), list[1] === null);
