class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [0, 1].map(index => (index === 0 ? new Item(1.5) : new Item(7)));
const list = held.values().toArray();
console.log(list.length);
console.log(list[0].double(), list[1].double());
