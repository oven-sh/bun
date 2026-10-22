// Object.entries reads each own property; here one was defined as a getter.
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
function read(hint) {
  log.push("get b " + (this === source) + " " + typeof hint);
  return item;
}
const source = { a: 1.5 };
Object.defineProperty(source, "b", { get: read, enumerable: true });
try {
  const result = Object.entries(source);
  console.log(result.map(entry => entry[0] + typeof entry[1]).join(), result.find(entry => typeof entry[1] === "object")[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
