class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const second = [1.5, item, "two"];
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue + 1, secondValue === item, secondValue.double(), typeof thirdValue);
  console.log(thirdValue.length, thirdValue, typeof this, arguments.length);
  return { made: 1.5 };
}
function otherCallback() {
  console.log("otherCallback", arguments.length);
  return { made: 1.5 };
}
const result = Reflect.construct(callback, second, otherCallback);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1);
