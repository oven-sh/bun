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
const result = Object.getOwnPropertyDescriptors(first);
console.log(typeof result, Object.keys(result).join(), typeof result[0], Object.keys(result[0]).join());
console.log(typeof result[0].value, result[0].value + 1, typeof result[0].writable, result[0].writable);
console.log(typeof result[0].enumerable, result[0].enumerable, typeof result[0].configurable, result[0].configurable, typeof result[1]);
console.log(Object.keys(result[1]).join(), result[1].value === item, result[1].value.double(), typeof result[1].writable, result[1].writable);
console.log(typeof result[1].enumerable, result[1].enumerable, typeof result[1].configurable, result[1].configurable, typeof result[2]);
console.log(Object.keys(result[2]).join(), typeof result[2].value, result[2].value.length, result[2].value);
console.log(typeof result[2].writable, result[2].writable, typeof result[2].enumerable, result[2].enumerable);
console.log(typeof result[2].configurable, result[2].configurable, typeof result.length, Object.keys(result.length).join());
console.log(typeof result.length.value, result.length.value + 1, typeof result.length.writable, result.length.writable);
console.log(typeof result.length.enumerable, result.length.enumerable, typeof result.length.configurable, result.length.configurable);
