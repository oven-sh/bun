class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
try {
  await Promise.any([Promise.reject(new Item(1.5))]);
} catch (error) {
  console.log(error.errors[0].double());
}
