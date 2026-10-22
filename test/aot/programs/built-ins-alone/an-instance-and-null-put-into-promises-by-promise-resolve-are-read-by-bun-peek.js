class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve(new Item(1.5)), Promise.resolve(null)];
await null;
await null;
await null;
console.log(Bun.peek(held[0]).double(), Bun.peek(held[1]) === null);
