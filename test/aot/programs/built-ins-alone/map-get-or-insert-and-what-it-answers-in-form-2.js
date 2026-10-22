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
const result = map.getOrInsert(1.5, 2.5);
console.log(typeof result, result + 1, map instanceof Map, map.size);
console.log(typeof map.get("first"), map.get("first") + 1, map.get("second") === item, map.get("second").double(), [...map.keys()].join());
