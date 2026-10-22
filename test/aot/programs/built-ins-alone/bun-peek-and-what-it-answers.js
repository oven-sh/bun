class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = new Promise(resolve => resolve(item));
const result = Bun.peek(first);
console.log(result === item, result.double());
