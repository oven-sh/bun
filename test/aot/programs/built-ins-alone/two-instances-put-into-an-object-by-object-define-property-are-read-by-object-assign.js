class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = {};
Object.defineProperty(held, "a", { value: new Item(1.5), enumerable: true });
Object.defineProperty(held, "b", { value: new Item(7), enumerable: true });
const copy = Object.assign({}, held);
console.log(copy.a.double(), copy.b.double());
