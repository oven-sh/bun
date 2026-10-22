class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
Reflect.set(held, 0, new Item(1.5));
Reflect.set(held, 1, new Item(7));
console.log(held.reduceRight((kept, value) => value).double(), held.reduce((kept, value) => value).double());
