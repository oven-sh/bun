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
const result = map.delete("second");
console.log(typeof result, result, map instanceof Map, map.size);
console.log(typeof map.get("first"), map.get("first") + 1, [...map.keys()].join());
