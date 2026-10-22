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
const result = Promise.resolve(first);
console.log(result === first);
