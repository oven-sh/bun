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
console.log(Reflect.get(held, "a").double(), Reflect.get(held, "b").double());
