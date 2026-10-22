class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const made = { size: 1.5 };
Reflect.setPrototypeOf(made, Item.prototype);
console.log(made.double());
