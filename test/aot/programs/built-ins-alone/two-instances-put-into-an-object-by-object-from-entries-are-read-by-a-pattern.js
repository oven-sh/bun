class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.fromEntries([["a", new Item(1.5)], ["b", new Item(7)]]);
const { a, b, c } = held;
console.log(a.double(), b.double());
console.log(c === undefined);
