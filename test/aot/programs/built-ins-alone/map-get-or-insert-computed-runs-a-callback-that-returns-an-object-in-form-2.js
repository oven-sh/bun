class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const map = new Map([["first", 1.5], ["second", item]]);
function callback(firstValue) {
  console.log("callback", typeof firstValue, firstValue + 1, this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = map.getOrInsertComputed(1.5, callback);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1, map instanceof Map);
console.log(map.size, typeof map.get("first"), map.get("first") + 1, map.get("second") === item, map.get("second").double());
console.log([...map.keys()].join());
