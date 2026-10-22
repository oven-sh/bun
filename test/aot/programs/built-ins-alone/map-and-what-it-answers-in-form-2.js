class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [["first", 1.5], ["second", item]];
const result = new Map(first);
console.log(result instanceof Map, result.size, typeof result.get("first"), result.get("first") + 1);
console.log(result.get("second") === item, result.get("second").double(), [...result.keys()].join());
