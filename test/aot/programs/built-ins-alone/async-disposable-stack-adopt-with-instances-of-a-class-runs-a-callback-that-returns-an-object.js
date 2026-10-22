class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new AsyncDisposableStack();
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.adopt(item, callback);
console.log(result === item, result.double());
