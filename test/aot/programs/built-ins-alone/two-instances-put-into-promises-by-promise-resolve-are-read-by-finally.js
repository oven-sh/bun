class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve(new Item(1.5)), Promise.resolve(new Item(7))];
console.log((await held[0].finally(() => {})).double(), (await held[1].finally(() => {})).double());
