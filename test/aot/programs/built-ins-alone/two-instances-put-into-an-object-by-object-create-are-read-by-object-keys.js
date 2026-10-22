class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.create(null, { a: { value: new Item(1.5), enumerable: true }, b: { value: new Item(7), enumerable: true } });
for (const key of Object.keys(held)) console.log(key, held[key].double());
