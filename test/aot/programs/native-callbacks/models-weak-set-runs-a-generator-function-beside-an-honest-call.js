// new WeakSet(..) runs the body of a generator function, which the program itself calls once with another receiver and with a number.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const log = [];
const keyA = { name: "a" };
const keyB = { name: "b" };
const values = [keyA, item];
function* walk(hint) {
  log.push("starts " + typeof hint);
  try {
    for (const value of values) yield value;
  } finally {
    log.push("ends");
  }
}
const source = { [Symbol.iterator]: walk };
walk(1).next();
log.length = 0;
try {
  const result = new WeakSet(source);
  console.log(result.has(keyA), result.has(item), result.has(keyB));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
