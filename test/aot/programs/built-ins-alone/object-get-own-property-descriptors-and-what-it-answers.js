class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = { first: 1.5, second: "two", third: item };
const result = Object.getOwnPropertyDescriptors(first);
console.log(typeof result, Object.keys(result).join(), typeof result.first, Object.keys(result.first).join());
console.log(typeof result.first.value, result.first.value + 1, typeof result.first.writable, result.first.writable);
console.log(typeof result.first.enumerable, result.first.enumerable, typeof result.first.configurable, result.first.configurable, typeof result.second);
console.log(Object.keys(result.second).join(), typeof result.second.value, result.second.value.length, result.second.value);
console.log(typeof result.second.writable, result.second.writable, typeof result.second.enumerable, result.second.enumerable);
console.log(typeof result.second.configurable, result.second.configurable, typeof result.third, Object.keys(result.third).join());
console.log(result.third.value === item, result.third.value.double(), typeof result.third.writable, result.third.writable);
console.log(typeof result.third.enumerable, result.third.enumerable, typeof result.third.configurable, result.third.configurable);
