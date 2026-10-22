class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = setImmediate(() => {});
const result = subject[Symbol.toPrimitive](item, 1.5);
console.log(typeof result);
