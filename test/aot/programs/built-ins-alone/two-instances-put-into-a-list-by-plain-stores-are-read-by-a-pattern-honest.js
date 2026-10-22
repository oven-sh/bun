class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held[0] = new Item(1.5);
held[1] = new Item(7);
const [first, second, third] = held;
console.log(first.double(), second.double());
console.log(third === undefined);
