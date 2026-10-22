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
  return "text";
}
const result = Map.groupBy(first, callback);
console.log(result instanceof Map, result.size, Array.isArray(result.get("text")), result.get("text").length);
console.log(typeof result.get("text")[0], result.get("text")[0] + 1, result.get("text")[1] === item, result.get("text")[1].double());
console.log(typeof result.get("text")[2], result.get("text")[2].length, result.get("text")[2], [...result.keys()].join());
