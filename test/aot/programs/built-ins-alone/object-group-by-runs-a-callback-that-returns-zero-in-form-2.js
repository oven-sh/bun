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
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return 0;
}
const result = Object.groupBy(first, callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result[0]), result[0].length);
console.log(typeof result[0][0], result[0][0] + 1, result[0][1] === item, result[0][1].double());
console.log(typeof result[0][2], result[0][2].length, result[0][2]);
