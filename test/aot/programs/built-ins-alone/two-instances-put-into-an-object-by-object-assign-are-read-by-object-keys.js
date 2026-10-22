class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: new Item(7) });
for (const key of Object.keys(held)) console.log(key, held[key].double());
