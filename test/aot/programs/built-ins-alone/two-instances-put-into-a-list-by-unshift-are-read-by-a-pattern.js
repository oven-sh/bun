class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.unshift(new Item(7));
held.unshift(new Item(1.5));
const [first, second, third] = held;
console.log(first.double(), second.double());
console.log(third === undefined);
