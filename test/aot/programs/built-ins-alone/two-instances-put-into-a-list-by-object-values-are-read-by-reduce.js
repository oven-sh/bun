class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.values({ a: new Item(1.5), b: new Item(7) });
console.log(held.reduceRight((kept, value) => value).double(), held.reduce((kept, value) => value).double());
