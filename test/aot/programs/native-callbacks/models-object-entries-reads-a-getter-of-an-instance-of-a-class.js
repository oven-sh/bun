// Object.entries reads each own property; here an instance of a class has an own getter.
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
class Holder {
  a = 1.5;
  constructor() {
    Object.defineProperty(this, "b", {
      get() {
        log.push("get b " + (this === source));
        return item;
      },
      enumerable: true,
    });
  }
}
const source = new Holder();
try {
  const result = Object.entries(source);
  console.log(result.map(entry => entry[0] + typeof entry[1]).join(), result.find(entry => typeof entry[1] === "object")[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
