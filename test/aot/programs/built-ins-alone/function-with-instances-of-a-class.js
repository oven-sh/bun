class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Function.prototype(item, 1.5);
console.log(typeof result, result === undefined);
