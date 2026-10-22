class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Object.assign("an", item, 2.5);
console.log(result instanceof String, typeof result.valueOf(), result.valueOf().length, result.valueOf());
