class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.push(new Item(1.5), new Item(7));
console.log(Object.getOwnPropertyDescriptor(held, 0).value.double(), Object.getOwnPropertyDescriptor(held, 1).value.double());
