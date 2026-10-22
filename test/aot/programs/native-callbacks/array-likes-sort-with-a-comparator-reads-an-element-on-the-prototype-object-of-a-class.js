// Array.prototype.sort reads index 1 of what it is given; here it is an instance of a class, and the element was stored into the prototype object of the class.
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
  0 = 1.5;
  2 = "two";
  length = 3;
}
Like.prototype[1] = item;
const like = new Like();
try {
  const result = Array.prototype.sort.call(like, (a, b) => {
    seen.push(typeof a + typeof b);
    return 0;
  });
  console.log(result === like, seen.length > 0, [like[0], like[1], like[2]].find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
