class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set().union(new Set([new Item(1.5), new Item(7)]));
const list = [...held.keys()];
console.log(list.length);
console.log(list[0].double(), list[1].double());
