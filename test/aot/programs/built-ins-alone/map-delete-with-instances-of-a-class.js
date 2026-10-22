class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const map = new Map([["first", item], ["second", item]]);
const result = map.delete("second");
console.log(typeof result, result, map instanceof Map, map.size);
console.log(map.get("first") === item, map.get("first").double(), [...map.keys()].join());
