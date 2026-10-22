class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? new Item(1.5) : new Item(7)));
for (const [index, value] of held.entries()) console.log(index + 1, value.double());
