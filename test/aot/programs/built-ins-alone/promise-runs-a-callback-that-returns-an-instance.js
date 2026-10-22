class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, typeof secondValue, this === undefined, arguments.length);
  return new Item(2.5);
}
const result = new Promise(callback);
console.log(result instanceof Promise);
