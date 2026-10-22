// Object.fromEntries runs the body of a generator function. Nothing else in the program reaches that code.
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
const values = [["a", 1.5], ["b", item], ["c", "two"]];
function* walk(hint) {
  log.push("starts " + typeof hint);
  try {
    for (const value of values) yield value;
  } finally {
    log.push("ends");
  }
}
const source = { [Symbol.iterator]: walk };
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
