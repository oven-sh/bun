// new WritableStream(..) reads close of what it is given; here it is the object's own.
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
  close() {
    log.push("close " + (this === holder) + " " + arguments.length);
  },
};
try {
  const result = await new WritableStream(holder).getWriter().close();
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
