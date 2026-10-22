class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Intl.DisplayNames.supportedLocalesOf(item, item);
console.log(Array.isArray(result), result.length);
