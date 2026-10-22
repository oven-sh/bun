class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.defineProperties({}, { a: { value: new Item(1.5), enumerable: true }, b: { value: new Item(7), enumerable: true } });
console.log(Object.getOwnPropertyDescriptor(held, "a").value.double(), Object.getOwnPropertyDescriptor(held, "b").value.double());
