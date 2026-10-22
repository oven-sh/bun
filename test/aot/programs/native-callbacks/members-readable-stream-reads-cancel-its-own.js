// new ReadableStream(..) reads cancel of what it is given; here it is the object's own.
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
  cancel(reason) {
    log.push("cancel " + (this === holder) + " " + arguments.length);
    kept.push(reason);
  },
};
try {
  const result = await new ReadableStream(holder).cancel(item);
  console.log(result, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
