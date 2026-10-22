class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.values({ a: new Item(1.5), b: new Item(7) });
console.log(held.length);
console.log(held[0].double(), held[1].double());
console.log(held[2] === undefined);
