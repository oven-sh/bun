// Object.assign, applied, reads index 1 of what it is given; here it is an instance of a class, and the element was stored into the prototype object of the class.
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
class Like {
  0 = {};
  2 = { more: 1.5 };
  length = 3;
}
Like.prototype[1] = { held: item };
const like = new Like();
try {
  const result = Object.assign.apply(null, like);
  console.log(result.held.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
