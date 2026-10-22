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
const result = Reflect.set(first, "-", item);
console.log(typeof result, result, typeof first, Object.keys(first).join());
console.log(typeof first.first, first.first + 1, typeof first.second, first.second.length, first.second);
console.log(first.third === item, first.third.double(), first["-"] === item, first["-"].double());
