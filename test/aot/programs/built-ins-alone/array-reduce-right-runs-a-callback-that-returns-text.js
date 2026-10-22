class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [1.5, item, "two"];
function callback(firstValue, secondValue, thirdValue, fourthValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue);
  console.log(typeof thirdValue, thirdValue + 1, fourthValue === list, this === undefined, arguments.length);
  return "text";
}
const result = list.reduceRight(callback);
console.log(typeof result, result.length, result);
