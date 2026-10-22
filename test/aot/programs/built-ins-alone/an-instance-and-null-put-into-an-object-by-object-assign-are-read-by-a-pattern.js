class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: null });
const { a, b, c } = held;
console.log(a.double(), b === null);
console.log(c === undefined);
