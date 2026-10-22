class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [1.5, item, "two"];
function callback(firstValue, secondValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = Map.groupBy(first, callback);
console.log(result instanceof Map, result.size, Array.isArray(result.get(true)), result.get(true).length);
console.log(typeof result.get(true)[0], result.get(true)[0] + 1, result.get(true)[1] === item, result.get(true)[1].double());
console.log(typeof result.get(true)[2], result.get(true)[2].length, result.get(true)[2], [...result.keys()].join());
console.log(Array.isArray(first), first.length, typeof first[0], first[0] + 1);
console.log(first[1] === item, first[1].double(), typeof first[2], first[2].length, first[2]);
console.log(typeof item.size, item.size.length, item.double());
