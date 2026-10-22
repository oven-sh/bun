class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set();
held.add(new Item(1.5));
held.add(null);
function use(first, second) {
  console.log(first.double(), second === null);
}
use(...held);
