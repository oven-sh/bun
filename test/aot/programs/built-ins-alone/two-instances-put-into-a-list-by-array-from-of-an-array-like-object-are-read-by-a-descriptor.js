class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Array.from({ length: 2, 0: new Item(1.5), 1: new Item(7) });
console.log(Object.getOwnPropertyDescriptor(held, 0).value.double(), Object.getOwnPropertyDescriptor(held, 1).value.double());
