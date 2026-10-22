class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const timer = setInterval(
  value => {
    console.log(value.double());
    clearInterval(timer);
  },
  1,
  new Item(1.5),
);
