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
const second = { first: 1.5, second: "two", third: item };
const result = subject.apply("text", second);
console.log(typeof result, result === undefined);
