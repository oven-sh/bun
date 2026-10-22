class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const made = Object.create(Item.prototype);
made.size = 1.5;
console.log(made.double(), made instanceof Item);
