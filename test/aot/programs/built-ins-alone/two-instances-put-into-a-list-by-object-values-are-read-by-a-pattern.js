class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.values({ a: new Item(1.5), b: new Item(7) });
const [first, second, third] = held;
console.log(first.double(), second.double());
console.log(third === undefined);
