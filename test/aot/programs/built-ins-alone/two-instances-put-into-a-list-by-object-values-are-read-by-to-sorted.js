class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.values({ a: new Item(1.5), b: new Item(7) });
const list = held.toSorted(() => 0);
console.log(list.length);
console.log(list[0].double(), list[1].double());
