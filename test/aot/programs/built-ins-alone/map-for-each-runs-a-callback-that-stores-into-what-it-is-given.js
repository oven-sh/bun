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
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue, thirdValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = map.forEach(callback, second);
console.log(typeof result, result === undefined, map instanceof Map, map.size);
console.log(typeof map.get("first"), map.get("first") + 1, map.get("second") === item, map.get("second").double(), [...map.keys()].join());
console.log(typeof second, Object.keys(second).join(), typeof second.first, second.first + 1);
console.log(typeof second.second, second.second.length, second.second, second.third === item, second.third.double());
console.log(typeof item.size, item.size.length, item.double());
