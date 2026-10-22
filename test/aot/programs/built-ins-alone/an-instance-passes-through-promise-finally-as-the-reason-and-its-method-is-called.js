class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
try {
  await Promise.reject(new Item(1.5)).finally(() => {});
} catch (error) {
  console.log(error.double());
}
