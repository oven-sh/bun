class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
process.on("unhandledRejection", reason => console.log(reason.double()));
Promise.reject(new Item(1.5));
