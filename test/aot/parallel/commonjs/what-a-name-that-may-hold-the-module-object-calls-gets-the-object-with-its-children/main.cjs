// A `var` may still be undefined, and what stands behind `&&` may be no object: such a name only may hold the module object. Where `exports` is called through it, what is called gets the object as `this`, with its children.
require("./lib.cjs");
module.exports = function () {
  return [this === module, typeof this.children, this.children.length, this.children[0].exports.a].join();
};
var held = module;
const tested = typeof module === "object" && module;
function inside() {
  var local = module;
  return local.exports();
}
console.log(held.exports());
console.log(tested.exports());
console.log(inside());
