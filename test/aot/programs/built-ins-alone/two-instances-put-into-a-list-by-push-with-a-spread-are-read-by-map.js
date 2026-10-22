class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.push(...[new Item(1.5), new Item(7)]);
const list = held.map(value => value);
console.log(list.length);
console.log(list[0].double(), list[1].double());
