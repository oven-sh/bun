class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Item(1.5));
    controller.close();
  },
});
console.log((await Bun.readableStreamToArray(stream))[0].double());
