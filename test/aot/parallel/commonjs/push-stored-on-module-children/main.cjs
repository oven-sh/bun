// The program stores a function as module.children.push, and the next read of module.children brings the list up to date through it.
const pushed = [];
module.children.push = function (child) {
  pushed.push(child.id.split(/[\\/]/).pop());
  return Array.prototype.push.call(this, child);
};
require("./child.cjs");
console.log(module.children.length, pushed.join());
console.log(delete module.children.push, typeof module.children.push, Object.keys(module.children).join());
