class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log(Object.getOwnPropertyDescriptor({ held: new Item(1.5) }, "held").value.double());
