class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: null });
for (const [key, value] of Object.entries(held)) console.log(key, value === null ? "null" : value.double());
