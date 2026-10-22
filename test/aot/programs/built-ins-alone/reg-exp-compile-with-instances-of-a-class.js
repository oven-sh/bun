class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = pattern.compile(item);
console.log(result === pattern, pattern instanceof RegExp, pattern.source, pattern.flags, pattern.lastIndex);
