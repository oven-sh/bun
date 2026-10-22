class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(new AggregateError([new Item(1.5)]).errors[0].double());
