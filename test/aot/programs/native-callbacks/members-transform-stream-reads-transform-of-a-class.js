// new TransformStream(..) reads transform of what it is given; here the object is an instance of a class whose prototype object has it.
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
class Holder {
  transform(chunk, controller) {
    log.push("transform " + (this === holder) + " " + arguments.length);
    controller.enqueue(chunk);
  }
}
const holder = new Holder();
try {
  const result = await (stream => (stream.writable.getWriter().write(item), stream.readable.getReader().read()))(new TransformStream(holder));
  console.log(result.done, result.value.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
