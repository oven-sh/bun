class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map().set("a", new Item(1.5)).set("b", new Item(7));
const copy = new Map(held);
console.log(copy.get("a").double(), copy.get("b").double());
