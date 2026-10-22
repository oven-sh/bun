// Intl.getCanonicalLocales reads index 1 of what it is given; here it is a plain object, and the plain object above it has a getter and a setter there.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
  toString() {
    log.push("toString " + (this === item));
    return "item " + this.size;
  }
}
const log = [];
const seen = [];
const item = new Item(1.5);
const like = {
  __proto__: {
    get 1() {
      log.push("get 1 " + (this === like));
      return "de";
    },
    set 1(value) {
      log.push("set 1 " + (this === like) + " " + typeof value);
    },
  },
  0: "en",
  2: "fr",
  length: 3,
};
try {
  const result = Intl.getCanonicalLocales(like);
  console.log(result.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
