class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve(new Item(1.5)), Promise.resolve(null)];
const list = await Promise.allSettled(held);
console.log(list[0].value.double(), list[1].value === null);
