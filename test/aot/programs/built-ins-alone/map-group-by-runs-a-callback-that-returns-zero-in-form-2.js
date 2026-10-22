class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [1.5, item, "two"];
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return 0;
}
const result = Map.groupBy(first, callback);
console.log(result instanceof Map, result.size, Array.isArray(result.get(0)), result.get(0).length);
console.log(typeof result.get(0)[0], result.get(0)[0] + 1, result.get(0)[1] === item, result.get(0)[1].double());
console.log(typeof result.get(0)[2], result.get(0)[2].length, result.get(0)[2], [...result.keys()].join());
