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
  return 0;
}
const result = process.nextTick(callback, second, 2.5);
console.log(typeof result, result === undefined);
