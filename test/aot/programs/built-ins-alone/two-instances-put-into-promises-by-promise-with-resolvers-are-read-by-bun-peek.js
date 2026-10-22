class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const left = Promise.withResolvers();
const right = Promise.withResolvers();
left.resolve(new Item(1.5));
right.resolve(new Item(7));
const held = [left.promise, right.promise];
await null;
await null;
await null;
console.log(Bun.peek(held[0]).double(), Bun.peek(held[1]).double());
