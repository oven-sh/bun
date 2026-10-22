class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [0].flatMap(() => [new Item(1.5), new Item(7)]);
function use(first, second) {
  console.log(first.double(), second.double());
}
use(...held);
