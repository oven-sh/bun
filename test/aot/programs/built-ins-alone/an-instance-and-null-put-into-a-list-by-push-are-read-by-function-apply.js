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
held.push(null);
function use(first, second) {
  console.log(first.double(), second === null);
}
use.apply(null, held);
