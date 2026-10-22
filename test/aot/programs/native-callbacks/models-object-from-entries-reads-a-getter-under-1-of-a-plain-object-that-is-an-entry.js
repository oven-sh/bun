// Object.fromEntries reads the members 0 and 1 of each entry; here an entry is a plain object and its member 1 is a getter.
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
    get 1() {
      log.push("get 1 of entry 0 " + (this === source[0]));
      return 1.5;
    },
    0: "a",
  },
  {
    get 1() {
      log.push("get 1 of entry 1 " + (this === source[1]));
      return item;
    },
    0: "b",
  },
  ["c", "two"],
];
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
