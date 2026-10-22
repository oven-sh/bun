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
const [first, second, third] = held;
console.log(first.double(), second.double());
console.log(third === undefined);
