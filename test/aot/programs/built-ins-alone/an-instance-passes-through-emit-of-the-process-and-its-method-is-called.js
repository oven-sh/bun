class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
process.on("ready", value => console.log(value.double()));
process.emit("ready", new Item(1.5));
