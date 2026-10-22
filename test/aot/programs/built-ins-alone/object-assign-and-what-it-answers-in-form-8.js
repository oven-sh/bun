class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const second = { first: 1.5, second: "two", third: item };
const result = Object.assign("an", second, 2.5);
console.log(result instanceof String, typeof result.valueOf(), result.valueOf().length, result.valueOf());
