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
  console.log("callback", arguments.length);
  return new Item(2.5);
}
const result = setImmediate(callback, 2.5, 2.5);
console.log(typeof result, Object.keys(result).join());
