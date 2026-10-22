// Object.entries reads each own property; here one is a getter written in the literal.
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
const source = {
  a: 1.5,
  get b() {
    log.push("get b " + (this === source));
    return item;
  },
  c: "two",
};
try {
  const result = Object.entries(source);
  console.log(result.map(entry => entry[0] + typeof entry[1]).join(), result.find(entry => typeof entry[1] === "object")[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
