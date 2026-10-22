// Object.groupBy runs the body of a generator function, which the program itself calls once with another receiver and with a number.
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
const values = [1.5, item, "two", 2.5];
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
  const result = Object.groupBy(source, value => {
    if (value === null) throw new RangeError("no kind");
    return typeof value;
  });
  console.log(Object.keys(result).join(), result.object[0].double(), result.number[1] + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
