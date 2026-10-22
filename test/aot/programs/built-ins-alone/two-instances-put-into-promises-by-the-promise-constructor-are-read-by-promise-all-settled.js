class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [new Promise(resolve => resolve(new Item(1.5))), new Promise(resolve => resolve(new Item(7)))];
const list = await Promise.allSettled(held);
console.log(list[0].value.double(), list[1].value.double());
