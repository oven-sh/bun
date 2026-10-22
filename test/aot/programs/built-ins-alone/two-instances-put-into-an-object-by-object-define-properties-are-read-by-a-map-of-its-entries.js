class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.defineProperties({}, { a: { value: new Item(1.5), enumerable: true }, b: { value: new Item(7), enumerable: true } });
const map = new Map(Object.entries(held));
console.log(map.get("a").double(), map.get("b").double());
