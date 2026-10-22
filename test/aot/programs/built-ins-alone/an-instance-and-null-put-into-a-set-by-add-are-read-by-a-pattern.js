class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set();
held.add(new Item(1.5));
held.add(null);
const [first, second, third] = held;
console.log(first.double(), second === null);
console.log(third === undefined);
