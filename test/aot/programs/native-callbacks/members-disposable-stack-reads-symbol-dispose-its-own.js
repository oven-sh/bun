// DisposableStack.prototype.use reads Symbol.dispose of what it is given; here it is the object's own.
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
  [Symbol.dispose]() {
    log.push("dispose " + (this === holder) + " " + arguments.length);
    kept.push(item.double());
  },
};
try {
  const result = (stack => (stack.use(holder), stack.dispose()))(new DisposableStack());
  console.log(result, kept[0]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
