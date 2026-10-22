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
const result = Object.assign(first, 2.5, "-");
console.log(result === first, Array.isArray(first), first.length);
console.log(typeof first[0], first[0].length, first[0], first[1] === item, first[1].double());
console.log(typeof first[2], first[2].length, first[2]);
