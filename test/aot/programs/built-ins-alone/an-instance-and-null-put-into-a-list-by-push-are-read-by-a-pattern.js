class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.push(new Item(1.5));
held.push(null);
const [first, second, third] = held;
console.log(first.double(), second === null);
console.log(third === undefined);
