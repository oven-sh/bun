class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? new Item(1.5) : new Item(7)));
const list = held.toSorted(() => 0);
console.log(list.length);
console.log(list[0].double(), list[1].double());
