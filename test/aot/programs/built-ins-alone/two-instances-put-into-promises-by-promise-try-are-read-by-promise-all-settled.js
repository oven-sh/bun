class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.try(() => new Item(1.5)), Promise.try(value => value, new Item(7))];
const list = await Promise.allSettled(held);
console.log(list[0].value.double(), list[1].value.double());
