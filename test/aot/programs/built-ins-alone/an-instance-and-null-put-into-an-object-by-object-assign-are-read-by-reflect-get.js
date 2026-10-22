class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: null });
console.log(Reflect.get(held, "a").double(), Reflect.get(held, "b") === null);
