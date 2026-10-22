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
const result = Array.from(first, callback, third);
console.log(Array.isArray(result), result.length, typeof result[0], result[0]);
console.log(typeof result[1], result[1], typeof result[2], result[2]);
console.log(Array.isArray(first), first.length, typeof first[0], first[0] + 1);
console.log(first[1] === item, first[1].double(), typeof first[2], first[2].length, first[2]);
console.log(typeof third, Object.keys(third).join(), typeof third.first, third.first + 1);
console.log(typeof third.second, third.second.length, third.second, third.third === item, third.third.double());
console.log(typeof item.size, item.size.length, item.double());
