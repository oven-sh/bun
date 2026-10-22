class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map([["a", new Item(1.5)], ["b", new Item(7)]]);
for (const [key, value] of held) console.log(key, value.double());
