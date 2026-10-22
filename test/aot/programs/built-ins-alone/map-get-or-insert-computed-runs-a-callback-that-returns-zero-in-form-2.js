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
  return 0;
}
const result = map.getOrInsertComputed(1.5, callback);
console.log(typeof result, result + 1, 1 / result, map instanceof Map, map.size);
console.log(typeof map.get("first"), map.get("first") + 1, map.get("second") === item, map.get("second").double(), [...map.keys()].join());
