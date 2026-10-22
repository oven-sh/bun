class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Object.assign(true, item, 2.5);
console.log(result instanceof Boolean, typeof result.valueOf(), result.valueOf());
