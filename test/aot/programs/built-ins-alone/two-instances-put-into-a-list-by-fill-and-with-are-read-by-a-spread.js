class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Array(2).fill(new Item(1.5)).with(1, new Item(7));
const list = [...held];
console.log(list.length);
console.log(list[0].double(), list[1].double());
