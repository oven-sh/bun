class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [(async () => new Item(1.5))(), (async () => new Item(7))()];
const list = await Promise.allSettled(held);
console.log(list[0].value.double(), list[1].value.double());
