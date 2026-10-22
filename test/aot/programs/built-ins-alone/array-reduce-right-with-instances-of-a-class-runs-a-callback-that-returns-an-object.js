class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [item, item, item];
function callback(firstValue, secondValue, thirdValue, fourthValue) {
  console.log("callback", typeof firstValue, firstValue, secondValue === item, secondValue.double(), typeof thirdValue);
  console.log(thirdValue + 1, fourthValue === list, this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = list.reduceRight(callback);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1);
