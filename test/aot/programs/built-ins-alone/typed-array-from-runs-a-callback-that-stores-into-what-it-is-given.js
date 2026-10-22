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
const third = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = Uint8Array.from(first, callback, third);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, Array.isArray(first), first.length);
console.log(typeof first[0], first[0] + 1, first[1] === item, first[1].double());
console.log(typeof first[2], first[2].length, first[2], typeof third, Object.keys(third).join());
console.log(typeof third.first, third.first + 1, typeof third.second, third.second.length, third.second);
console.log(third.third === item, third.third.double());
console.log(typeof item.size, item.size.length, item.double());
