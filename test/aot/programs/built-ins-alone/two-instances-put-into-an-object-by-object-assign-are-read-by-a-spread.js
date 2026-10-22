class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: new Item(7) });
const copy = { ...held };
console.log(copy.a.double(), copy.b.double());
