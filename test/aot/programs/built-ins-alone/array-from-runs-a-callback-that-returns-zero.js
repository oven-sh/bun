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
  return 0;
}
const result = Array.from(1.5, callback, third);
console.log(Array.isArray(result), result.length);
