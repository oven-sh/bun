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
console.log(held.a.double(), held.b.double());
console.log(held.c === undefined);
