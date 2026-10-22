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
console.log(held.a.double(), held.b.double());
console.log(held.c === undefined);
