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
const result = map.set(1.5, 2.5);
console.log(result === map, map instanceof Map, map.size, typeof map.get("first"), map.get("first") + 1);
console.log(map.get("second") === item, map.get("second").double(), [...map.keys()].join());
