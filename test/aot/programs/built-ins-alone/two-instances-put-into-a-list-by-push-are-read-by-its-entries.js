class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.push(new Item(1.5));
held.push(new Item(7));
for (const [index, value] of held.entries()) console.log(index + 1, value.double());
