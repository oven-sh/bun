class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Object.create(Item.prototype, { size: { value: 1.5 } }).double());
