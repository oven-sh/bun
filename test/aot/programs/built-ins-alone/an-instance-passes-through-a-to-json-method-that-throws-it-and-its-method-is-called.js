class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
try {
  JSON.stringify({
    toJSON() {
      throw new Item(1.5);
    },
  });
} catch (error) {
  console.log(error.double());
}
