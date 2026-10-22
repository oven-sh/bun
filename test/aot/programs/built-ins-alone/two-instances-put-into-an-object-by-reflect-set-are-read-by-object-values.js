class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = {};
Reflect.set(held, "a", new Item(1.5));
Reflect.set(held, "b", new Item(7));
const list = Object.values(held);
console.log(list.length);
console.log(list[0].double(), list[1].double());
