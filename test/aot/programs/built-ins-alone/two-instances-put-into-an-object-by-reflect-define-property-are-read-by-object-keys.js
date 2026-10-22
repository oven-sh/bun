class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = {};
Reflect.defineProperty(held, "a", { value: new Item(1.5), enumerable: true });
Reflect.defineProperty(held, "b", { value: new Item(7), enumerable: true });
for (const key of Object.keys(held)) console.log(key, held[key].double());
