class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = Object.values({ a: new Item(1.5), b: new Item(7) });
console.log(held.shift().double(), held.pop().double());
console.log(held.length, held.pop() === undefined);
