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
  return new Item(2.5);
}
const result = Object.groupBy(first, callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result["[object Object]"]), result["[object Object]"].length);
console.log(typeof result["[object Object]"][0], result["[object Object]"][0] + 1, result["[object Object]"][1] === item, result["[object Object]"][1].double());
console.log(typeof result["[object Object]"][2], result["[object Object]"][2].length, result["[object Object]"][2]);
