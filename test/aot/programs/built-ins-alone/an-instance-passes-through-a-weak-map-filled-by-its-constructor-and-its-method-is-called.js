class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const key = {};
console.log(new WeakMap([[key, new Item(1.5)]]).get(key).double());
