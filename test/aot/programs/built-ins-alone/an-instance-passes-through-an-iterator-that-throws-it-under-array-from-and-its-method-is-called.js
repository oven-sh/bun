class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
try {
  Array.from({
    [Symbol.iterator]() {
      throw new Item(1.5);
    },
  });
} catch (error) {
  console.log(error.double());
}
