class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.defineProperties({}, { a: { value: new Item(1.5), enumerable: true }, b: { value: new Item(7), enumerable: true } });
const { a, b, c } = held;
console.log(a.double(), b.double());
console.log(c === undefined);
