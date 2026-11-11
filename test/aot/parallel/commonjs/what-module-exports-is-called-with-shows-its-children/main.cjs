// `module.exports()` is a call through `module`: what is called gets the module object as `this`, with all that it shows: its children too, and what they export.
"use strict";
require("./lib.cjs");
module.exports = function () {
  const [child] = this.children;
  return [this === module, Array.isArray(this.children), this.children.length, child.exports.a, child.parent === this, typeof this.loaded, typeof this.id].join();
};
console.log(module.exports());
console.log(module.exports?.());
console.log(module["exports"]());
console.log(module.exports`tagged`);
