// Object.entries reads each own property; here a getter deletes the one behind it and adds another.
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
  get a() {
    log.push("get a " + (this === source));
    delete this.b;
    this.d = 2.5;
    return item;
  },
  b: 1.5,
  c: "two",
};
try {
  const result = Object.entries(source);
  console.log(result.map(entry => entry[0] + typeof entry[1]).join(), result.find(entry => typeof entry[1] === "object")[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
