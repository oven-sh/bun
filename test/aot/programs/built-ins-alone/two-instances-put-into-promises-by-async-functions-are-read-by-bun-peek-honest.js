class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [(async () => new Item(1.5))(), (async () => new Item(7))()];
await null;
await null;
await null;
console.log(Bun.peek(held[0]).double(), Bun.peek(held[1]).double());
