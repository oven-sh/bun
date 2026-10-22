class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
try {
  await new Promise((resolve, reject) => reject(new Item(1.5)));
} catch (error) {
  console.log(error.double());
}
