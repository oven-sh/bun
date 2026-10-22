// new WritableStream(..) reads write of what it is given; here the object is an instance of a class whose prototype object has it.
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
  write(chunk, controller) {
    log.push("write " + (this === holder) + " " + arguments.length);
    kept.push(chunk);
  }
}
const holder = new Holder();
try {
  const result = await new WritableStream(holder).getWriter().write(item);
  console.log(result, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
