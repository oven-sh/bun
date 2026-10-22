class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
function callback() {
  console.log("callback", this === undefined, arguments.length);
  return new Item(2.5);
}
const result = queueMicrotask(callback);
console.log(typeof result, result === undefined);
