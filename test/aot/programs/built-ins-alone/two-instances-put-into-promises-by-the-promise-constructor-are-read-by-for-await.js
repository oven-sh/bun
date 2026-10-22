class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [new Promise(resolve => resolve(new Item(1.5))), new Promise(resolve => resolve(new Item(7)))];
for await (const value of held) console.log(value.double());
