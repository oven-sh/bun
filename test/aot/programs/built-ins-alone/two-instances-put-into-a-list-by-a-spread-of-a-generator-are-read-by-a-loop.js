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
for (const value of held) console.log(value.double());
