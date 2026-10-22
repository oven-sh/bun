class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = function work(first, second) {
  return second;
};
const result = subject.apply(item, item);
console.log(typeof result, result === undefined);
