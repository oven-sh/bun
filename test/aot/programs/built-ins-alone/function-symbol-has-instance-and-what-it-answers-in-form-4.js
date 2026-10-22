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
const first = [1.5, item, "two"];
const result = subject[Symbol.hasInstance](first);
console.log(typeof result, result);
