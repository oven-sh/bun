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
const result = Object.assign(first, "text", 1.5);
console.log(result === first, typeof first, Object.keys(first).join());
console.log(typeof first[0], first[0].length, first[0]);
console.log(typeof first[1], first[1].length, first[1]);
console.log(typeof first[2], first[2].length, first[2]);
console.log(typeof first[3], first[3].length, first[3]);
