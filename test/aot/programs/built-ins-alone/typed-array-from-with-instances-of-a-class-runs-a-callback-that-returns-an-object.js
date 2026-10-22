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
  return { made: 1.5 };
}
const result = Uint8Array.from(item, callback, item);
console.log(result instanceof Uint8Array, result.length);
