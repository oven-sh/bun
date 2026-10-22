class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = { first: item, second: item };
const result = subject.__lookupGetter__("an");
console.log(typeof result, result === undefined);
