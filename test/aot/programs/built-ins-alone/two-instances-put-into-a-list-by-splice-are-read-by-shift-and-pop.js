class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [];
held.splice(0, 0, new Item(1.5), new Item(7));
console.log(held.shift().double(), held.pop().double());
console.log(held.length, held.pop() === undefined);
