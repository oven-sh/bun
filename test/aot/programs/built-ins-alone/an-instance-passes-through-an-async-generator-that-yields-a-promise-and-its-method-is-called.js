class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
async function* values() {
  yield Promise.resolve(new Item(1.5));
}
for await (const value of values()) console.log(value.double());
