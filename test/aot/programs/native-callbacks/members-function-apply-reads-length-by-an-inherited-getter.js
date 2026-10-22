// Function.prototype.apply reads length of what it is given; here the plain object above has a getter under that name.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const log = [];
const kept = [];
const item = new Item(1.5);
function take(first, second) {
  return typeof first + " " + second.double() + " " + arguments.length;
}
const holder = {
  __proto__: {
    get length() {
      log.push("get length " + (this === holder));
      return 2;
    },
  },
  0: 1.5,
  1: item,
};
try {
  const result = take.apply(null, holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
