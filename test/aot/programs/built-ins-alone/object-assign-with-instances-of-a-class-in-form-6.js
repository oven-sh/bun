class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Object.assign(5n, item, 2.5);
console.log(result instanceof BigInt, typeof result.valueOf(), result.valueOf() + 1n);
