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
console.log(held.shift().double(), held.pop() === null);
console.log(held.length, held.pop() === undefined);
