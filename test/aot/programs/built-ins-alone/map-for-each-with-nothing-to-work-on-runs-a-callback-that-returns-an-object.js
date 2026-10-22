class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const map = new Map();
const second = { first: 1.5, second: "two", third: item };
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = map.forEach(callback, second);
console.log(typeof result, result === undefined);
