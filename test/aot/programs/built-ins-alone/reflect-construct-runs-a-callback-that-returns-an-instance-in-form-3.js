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
  return new Item(2.5);
}
function otherCallback() {
  console.log("otherCallback", arguments.length);
  return new Item(2.5);
}
const result = Reflect.construct(callback, second, otherCallback);
console.log(result.double());
