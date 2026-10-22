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
const result = map.set(item, item);
console.log(result === map, map instanceof Map, map.size, map.get("first") === item, map.get("first").double());
console.log(map.get("second") === item, map.get("second").double());
