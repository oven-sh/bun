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
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue, typeof thirdValue);
  console.log(thirdValue + 1, fourthValue === list, this === undefined, arguments.length);
  return new Item(2.5);
}
const result = list.reduceRight(callback);
console.log(result.double());
