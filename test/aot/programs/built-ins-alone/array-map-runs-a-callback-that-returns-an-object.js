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
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, thirdValue === list);
  console.log(this === second, arguments.length);
  return { made: 1.5 };
}
const result = list.map(callback, second);
console.log(Array.isArray(result), result.length, typeof result[0], Object.keys(result[0]).join());
console.log(typeof result[0].made, result[0].made + 1, typeof result[1], Object.keys(result[1]).join());
console.log(typeof result[1].made, result[1].made + 1, typeof result[2], Object.keys(result[2]).join());
console.log(typeof result[2].made, result[2].made + 1);
