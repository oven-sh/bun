class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Object.assign(Object.create(Item.prototype), { size: 1.5 }).double());
