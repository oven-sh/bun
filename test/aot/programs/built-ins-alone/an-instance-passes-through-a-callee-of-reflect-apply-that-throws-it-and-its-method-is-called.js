class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
try {
  Reflect.apply(() => {
    throw new Item(1.5);
  }, null, []);
} catch (error) {
  console.log(error.double());
}
