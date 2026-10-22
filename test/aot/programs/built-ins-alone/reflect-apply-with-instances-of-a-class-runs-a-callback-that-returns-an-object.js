class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const third = { first: 1.5, second: "two", third: item };
function callback() {
  console.log("callback", this === item, arguments.length);
  return { made: 1.5 };
}
const result = Reflect.apply(callback, item, third);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1);
