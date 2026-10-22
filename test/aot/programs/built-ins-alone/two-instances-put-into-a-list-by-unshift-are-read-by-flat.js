class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.unshift(new Item(7));
held.unshift(new Item(1.5));
const list = [held].flat();
console.log(list.length);
console.log(list[0].double(), list[1].double());
