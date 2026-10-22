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
  return "text";
}
const result = Object.groupBy(first, callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.text), result.text.length);
console.log(typeof result.text[0], result.text[0] + 1, result.text[1] === item, result.text[1].double());
console.log(typeof result.text[2], result.text[2].length, result.text[2]);
