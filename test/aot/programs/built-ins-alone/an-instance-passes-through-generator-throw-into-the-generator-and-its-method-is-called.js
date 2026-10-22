class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
function* values() {
  try {
    yield 1;
  } catch (error) {
    console.log(error.double());
  }
}
const running = values();
running.next();
running.throw(new Item(1.5));
