// new ReadableStream(..) reads start of what it is given; here the object has a getter under that name.
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
  get start() {
    log.push("get start " + (this === holder));
    return function (controller) {
      log.push("start " + (this === holder) + " " + arguments.length);
      controller.enqueue(item);
      controller.close();
    };
  },
};
try {
  const result = await new ReadableStream(holder).getReader().read();
  console.log(result.done, result.value.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
