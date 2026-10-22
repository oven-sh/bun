// new ReadableStream(.., a strategy) reads size of what it is given; here the object has a getter under that name.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const log = [];
const kept = [];
const item = new Item(1.5);
const holder = {
  get size() {
    log.push("get size " + (this === holder));
    return function (chunk) {
      log.push("size " + typeof chunk);
      kept.push(chunk);
      return 1;
    };
  },
  highWaterMark: 1,
};
try {
  const result = await new ReadableStream({
    start(controller) {
      controller.enqueue(item);
      controller.close();
    },
  }, holder).getReader().read();
  console.log(result.value.double(), kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
