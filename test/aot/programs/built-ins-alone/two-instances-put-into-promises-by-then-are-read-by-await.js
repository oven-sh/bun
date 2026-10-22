class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve().then(() => new Item(1.5)), Promise.resolve().then(() => new Item(7))];
console.log((await held[0]).double(), (await held[1]).double());
