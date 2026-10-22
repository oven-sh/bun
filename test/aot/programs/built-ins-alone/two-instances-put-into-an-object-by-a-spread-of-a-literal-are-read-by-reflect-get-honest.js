class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = { ...{ a: new Item(1.5) }, b: new Item(7) };
console.log(Reflect.get(held, "a").double(), Reflect.get(held, "b").double());
