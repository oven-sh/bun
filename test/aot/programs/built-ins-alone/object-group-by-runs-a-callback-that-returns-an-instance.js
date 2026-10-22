class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(this === undefined, arguments.length);
  return new Item(2.5);
}
const result = Object.groupBy("an", callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result["[object Object]"]), result["[object Object]"].length);
console.log(typeof result["[object Object]"][0], result["[object Object]"][0].length, result["[object Object]"][0]);
console.log(typeof result["[object Object]"][1], result["[object Object]"][1].length, result["[object Object]"][1]);
