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
const result = Object.defineProperty(first, "-", third);
console.log(result === first, Array.isArray(first), first.length, typeof first[0], first[0] + 1);
console.log(first[1] === item, first[1].double(), typeof first[2], first[2].length, first[2]);
