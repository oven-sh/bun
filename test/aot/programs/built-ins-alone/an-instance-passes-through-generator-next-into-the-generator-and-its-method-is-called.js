class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
function* values() {
  console.log((yield 1).double());
}
const running = values();
running.next();
running.next(new Item(1.5));
