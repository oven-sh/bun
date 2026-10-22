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
function use(first, second) {
  console.log(first.double(), second.double());
}
use.apply(null, held);
