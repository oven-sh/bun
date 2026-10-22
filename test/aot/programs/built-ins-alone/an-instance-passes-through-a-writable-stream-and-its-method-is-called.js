class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const stream = new WritableStream({
  write(chunk) {
    console.log(chunk.double());
  },
});
await stream.getWriter().write(new Item(1.5));
