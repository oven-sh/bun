class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const second = { first: 1.5, second: "two", third: item };
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = setImmediate(callback, second, 2.5);
console.log(typeof result, Object.keys(result).join());
