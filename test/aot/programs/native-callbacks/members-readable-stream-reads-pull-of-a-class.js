// new ReadableStream(..) reads pull of what it is given; here the object is an instance of a class whose prototype object has it.
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
  pull(controller) {
    log.push("pull " + (this === holder) + " " + arguments.length);
    controller.enqueue(item);
    controller.close();
  }
}
const holder = new Holder();
try {
  const result = await new ReadableStream(holder).getReader().read();
  console.log(result.done, result.value.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
