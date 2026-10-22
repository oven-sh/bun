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
for (const [key, value] of Object.entries(held)) console.log(key, value.double());
