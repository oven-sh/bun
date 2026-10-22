class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Set();
held.add(new Item(1.5));
held.add(null);
const list = [...held.keys()];
console.log(list.length);
console.log(list[0].double(), list[1] === null);
