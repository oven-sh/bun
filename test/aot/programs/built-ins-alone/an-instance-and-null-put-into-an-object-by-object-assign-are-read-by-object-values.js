class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.assign({}, { a: new Item(1.5) }, { b: null });
const list = Object.values(held);
console.log(list.length);
console.log(list[0].double(), list[1] === null);
