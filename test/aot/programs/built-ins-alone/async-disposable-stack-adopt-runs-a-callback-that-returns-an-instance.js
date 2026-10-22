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
  return new Item(2.5);
}
const result = subject.adopt(1.5, callback);
console.log(typeof result, result + 1);
