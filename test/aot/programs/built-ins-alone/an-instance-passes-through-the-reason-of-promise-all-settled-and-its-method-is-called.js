class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log((await Promise.allSettled([Promise.reject(new Item(1.5))]))[0].reason.double());
