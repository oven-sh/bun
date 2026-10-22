// new Map(..) reads the members 0 and 1 of each entry; here an entry is a plain object and its member 0 is a getter.
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
const source = [
  {
    get 0() {
      log.push("get 0 of entry 0 " + (this === source[0]));
      return "a";
    },
    1: 1.5,
  },
  {
    get 0() {
      log.push("get 0 of entry 1 " + (this === source[1]));
      return "b";
    },
    1: item,
  },
  [item, "two"],
];
try {
  const result = new Map(source);
  console.log(result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
