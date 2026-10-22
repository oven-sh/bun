class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.fromEntries([["a", new Item(1.5)], ["b", new Item(7)]]);
const map = new Map(Object.entries(held));
console.log(map.get("a").double(), map.get("b").double());
