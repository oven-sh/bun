// DisposableStack.prototype.use reads Symbol.dispose of what it is given; here the object is an instance of a class whose prototype object has it.
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
  [Symbol.dispose]() {
    log.push("dispose " + (this === holder) + " " + arguments.length);
    kept.push(item.double());
  }
}
const holder = new Holder();
try {
  const result = (stack => (stack.use(holder), stack.dispose()))(new DisposableStack());
  console.log(result, kept[0]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
