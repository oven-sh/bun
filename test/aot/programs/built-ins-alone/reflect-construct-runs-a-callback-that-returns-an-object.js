class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const second = { first: 1.5, second: "two", third: item };
function callback() {
  console.log("callback", typeof this, arguments.length);
  return { made: 1.5 };
}
const result = Reflect.construct(callback, second);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1);
