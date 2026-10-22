class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
function* values() {
  yield* [new Item(1.5)];
}
console.log(values().next().value.double());
