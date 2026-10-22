class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.push(new Item(1.5));
held.push(null);
console.log(held.length);
console.log(held[0].double(), held[1] === null);
console.log(held[2] === undefined);
