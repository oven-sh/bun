class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
function* values() {
  yield new Item(1.5);
  yield new Item(7);
}
const held = [...values()];
console.log(held.reduceRight((kept, value) => value).double(), held.reduce((kept, value) => value).double());
