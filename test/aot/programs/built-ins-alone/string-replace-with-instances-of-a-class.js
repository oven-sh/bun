class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
const result = "banana".replace(first, item);
console.log(typeof result, result.length, result);
