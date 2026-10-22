class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [1.5, item, "two"];
function callback(firstValue, secondValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = Object.groupBy(first, callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.true), result.true.length);
console.log(typeof result.true[0], result.true[0] + 1, result.true[1] === item, result.true[1].double());
console.log(typeof result.true[2], result.true[2].length, result.true[2], Array.isArray(first), first.length);
console.log(typeof first[0], first[0] + 1, first[1] === item, first[1].double());
console.log(typeof first[2], first[2].length, first[2]);
console.log(typeof item.size, item.size.length, item.double());
