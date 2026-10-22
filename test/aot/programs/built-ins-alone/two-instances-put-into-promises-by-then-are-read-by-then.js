class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve().then(() => new Item(1.5)), Promise.resolve().then(() => new Item(7))];
await held[0].then(value => console.log(value.double()));
await held[1].then(value => console.log(value.double()));
