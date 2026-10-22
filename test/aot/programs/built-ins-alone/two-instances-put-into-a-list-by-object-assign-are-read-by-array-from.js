class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign([], { 0: new Item(1.5), 1: new Item(7) });
const list = Array.from(held);
console.log(list.length);
console.log(list[0].double(), list[1].double());
