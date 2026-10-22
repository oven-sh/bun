class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const third = { first: 1.5, second: "two", third: item };
function callback() {
  console.log("callback", arguments.length);
  return "text";
}
const result = Uint8Array.from(1.5, callback, third);
console.log(result instanceof Uint8Array, result.length);
