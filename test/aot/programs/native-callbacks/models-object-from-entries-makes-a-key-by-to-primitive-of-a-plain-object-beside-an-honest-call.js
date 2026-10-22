// Object.fromEntries turns a plain object into a property key by its Symbol.toPrimitive, which the program itself calls once with another receiver and with a number.
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
const key = {
  tag: "key",
  [Symbol.toPrimitive](hint) {
    log.push("toPrimitive " + (this === key) + " " + hint + " " + (this.tag + 1));
    return "b";
  },
};
key[Symbol.toPrimitive].call({ tag: 7 }, 1);
log.length = 0;
try {
  const result = Object.fromEntries([["a", 1.5], [key, item]]);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
