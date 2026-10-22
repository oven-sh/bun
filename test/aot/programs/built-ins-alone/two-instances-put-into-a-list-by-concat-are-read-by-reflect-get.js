class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [].concat(new Item(1.5), [new Item(7)]);
console.log(Reflect.get(held, 0).double(), Reflect.get(held, "1").double());
