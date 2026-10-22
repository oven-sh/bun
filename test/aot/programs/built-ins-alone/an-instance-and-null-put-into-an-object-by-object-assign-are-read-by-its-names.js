class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: null });
console.log(held.a.double(), held.b === null);
console.log(held.c === undefined);
