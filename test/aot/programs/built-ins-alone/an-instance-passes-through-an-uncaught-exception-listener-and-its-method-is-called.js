class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
process.on("uncaughtException", error => console.log(error.double()));
setTimeout(() => {
  throw new Item(1.5);
}, 0);
