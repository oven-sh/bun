class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.unshift(new Item(7));
held.unshift(new Item(1.5));
console.log(Object.getOwnPropertyDescriptor(held, 0).value.double(), Object.getOwnPropertyDescriptor(held, 1).value.double());
