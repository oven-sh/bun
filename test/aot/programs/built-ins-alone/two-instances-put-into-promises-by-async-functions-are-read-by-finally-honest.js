class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [(async () => new Item(1.5))(), (async () => new Item(7))()];
console.log((await held[0].finally(() => {})).double(), (await held[1].finally(() => {})).double());
