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
const result = Object.entries(first);
console.log(Array.isArray(result), result.length, Array.isArray(result[0]), result[0].length);
console.log(typeof result[0][0], result[0][0].length, result[0][0], typeof result[0][1], result[0][1] + 1);
console.log(Array.isArray(result[1]), result[1].length, typeof result[1][0], result[1][0].length, result[1][0]);
console.log(result[1][1] === item, result[1][1].double(), Array.isArray(result[2]), result[2].length);
console.log(typeof result[2][0], result[2][0].length, result[2][0]);
console.log(typeof result[2][1], result[2][1].length, result[2][1]);
