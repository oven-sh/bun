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
console.log(Reflect.get(held, 0).double(), Reflect.get(held, "1").double());
