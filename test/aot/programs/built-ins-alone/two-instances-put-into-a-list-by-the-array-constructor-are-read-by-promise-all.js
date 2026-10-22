class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Array(new Item(1.5), new Item(7));
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0].double(), list[1].double());
