class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
function* values() {
  yield new Item(1.5);
  yield new Item(7);
}
const held = [...values()];
const list = Array.from(held);
console.log(list.length);
console.log(list[0].double(), list[1].double());
