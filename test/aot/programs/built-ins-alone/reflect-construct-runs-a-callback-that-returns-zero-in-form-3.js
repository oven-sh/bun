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
  return 0;
}
function otherCallback() {
  console.log("otherCallback", arguments.length);
  return 0;
}
const result = Reflect.construct(callback, second, otherCallback);
console.log(typeof result, Object.keys(result).join());
