class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = new Map();
held.set(new Item(1.5), "a");
held.set(null, "b");
const list = [...held];
console.log(list[0][0].double(), list[1][0] === null);
