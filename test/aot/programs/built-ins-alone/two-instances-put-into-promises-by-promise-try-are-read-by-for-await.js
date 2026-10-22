class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.try(() => new Item(1.5)), Promise.try(value => value, new Item(7))];
for await (const value of held) console.log(value.double());
