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
const list = await Promise.allSettled(held);
console.log(list[0].value.double(), list[1].value.double());
