class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const map = new Map([["first", 1.5], ["second", item]]);
function callback() {
  console.log("callback", arguments.length);
  return new Item(2.5);
}
const result = map.getOrInsertComputed("second", callback);
console.log(result === item, result.double());
