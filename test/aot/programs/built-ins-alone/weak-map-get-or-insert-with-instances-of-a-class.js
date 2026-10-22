class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const key = { name: 1 };
const subject = new WeakMap([[key, item]]);
const result = subject.getOrInsert(key, item);
console.log(result === item, result.double());
