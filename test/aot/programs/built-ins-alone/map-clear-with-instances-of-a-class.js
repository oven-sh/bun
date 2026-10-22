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
const result = map.clear();
console.log(typeof result, result === undefined, map instanceof Map, map.size, [...map.keys()].join());
