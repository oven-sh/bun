class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve(new Item(1.5)), Promise.resolve(null)];
for await (const value of held) console.log(value === null ? "null" : value.double());
