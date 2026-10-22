class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.resolve(Promise.resolve(new Item(1.5))), Promise.resolve(Promise.resolve(new Item(7)))];
console.log((await Promise.race(held)).double(), (await Promise.any(held)).double());
