class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = [item, "two"].values().map(value => value);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
