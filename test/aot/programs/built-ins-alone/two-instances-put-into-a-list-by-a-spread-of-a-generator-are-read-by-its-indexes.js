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
console.log(held.length);
console.log(held[0].double(), held[1].double());
console.log(held[2] === undefined);
