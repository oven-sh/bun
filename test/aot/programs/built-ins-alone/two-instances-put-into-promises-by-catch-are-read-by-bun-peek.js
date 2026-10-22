class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.reject(new Item(1.5)).catch(reason => reason), Promise.reject(new Item(7)).catch(reason => reason)];
await null;
await null;
await null;
console.log(Bun.peek(held[0]).double(), Bun.peek(held[1]).double());
