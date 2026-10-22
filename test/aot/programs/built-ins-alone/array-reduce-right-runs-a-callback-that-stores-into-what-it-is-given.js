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
  if (secondValue instanceof Item) secondValue.size = "changed";
  return true;
}
const result = list.reduceRight(callback);
console.log(typeof result, result, Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, list[1] === item, list[1].double());
console.log(typeof list[2], list[2].length, list[2]);
console.log(typeof item.size, item.size.length, item.double());
