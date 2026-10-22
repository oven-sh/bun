let calls = 0;
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
class Special extends Map {
  count = 0;
  set(firstValue, secondValue, thirdValue) {
    calls++;
    this.count++;
    console.log("set", arguments.length, typeof firstValue, typeof secondValue, typeof thirdValue);
    return super.set(...arguments);
  }
}
const result = new Special(first);
console.log(typeof result, result.size, typeof result.get("first"), result.get("first") + 1);
console.log(result.get("second") === item, result.get("second").double(), [...result.keys()].join());
console.log(result instanceof Special, calls, result.count);
