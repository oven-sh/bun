class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const stream = new TransformStream();
stream.writable.getWriter().write(new Item(1.5));
console.log((await stream.readable.getReader().read()).value.double());
