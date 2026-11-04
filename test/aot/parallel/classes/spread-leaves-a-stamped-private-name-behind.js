// A class whose parent answers its argument gives its private names to a literal. They are no properties: a spread of the literal copies none of them.
class ReturnsArgument {
  constructor(o) {
    return o;
  }
}
class Stamp extends ReturnsArgument {
  #stamp = 5;
  #method() {
    return 1;
  }
  static has(o) {
    return #stamp in o;
  }
  static hasMethod(o) {
    return #method in o;
  }
}
const stamped = { a: 1, b: "x" };
new Stamp(stamped);
const keys = [];
for (const key in stamped) keys.push(key);
const copy = { ...stamped };
console.log(keys.join(), Stamp.has(stamped), Stamp.hasMethod(stamped), Stamp.has(copy), Stamp.hasMethod(copy), Object.keys(copy).join());
