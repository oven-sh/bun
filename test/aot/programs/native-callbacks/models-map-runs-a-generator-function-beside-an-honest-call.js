// new Map(..) runs the body of a generator function, which the program itself calls once with another receiver and with a number.
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
const values = [["a", 1.5], ["b", item], [item, "two"]];
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
  const result = new Map(source);
  console.log(result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
