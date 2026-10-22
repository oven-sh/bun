class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
function* values() {
  yield 1;
}
console.log(values().return(new Item(1.5)).value.double());
