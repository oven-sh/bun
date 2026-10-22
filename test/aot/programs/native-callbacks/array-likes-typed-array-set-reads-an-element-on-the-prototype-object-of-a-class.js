// %TypedArray%.prototype.set reads index 1 of what it is given; here it is an instance of a class, and the element was stored into the prototype object of the class.
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
const target = new Float64Array(3);
class Like {
  0 = 1.5;
  2 = "two";
  length = 3;
}
Like.prototype[1] = item;
const like = new Like();
try {
  const result = target.set(like);
  console.log(result, target[0], target[1]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
