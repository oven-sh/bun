class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: null });
for (const key in held) console.log(key, held[key] === null ? "null" : held[key].double());
