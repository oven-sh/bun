class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [].concat(new Item(1.5), [new Item(7)]);
console.log(held.length);
console.log(held[0].double(), held[1].double());
console.log(held[2] === undefined);
