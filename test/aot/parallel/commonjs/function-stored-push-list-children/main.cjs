// The loader appends a required file's module object to `module.children` by calling the `push` that it finds on the list. Each line reads the list first, so it says the same whether the call comes at the require or at the next read.
const list = module.children;
const push = list.push;
const seen = [];
list.push = function (child) {
  seen.push(this === list, child.exports.name);
  return push.call(this, child);
};
require("./first.cjs");
console.log(module.children.length, seen.join());
list.push = function (child) {
  seen.push("again", typeof child.exports.greet);
  return push.call(this, { exports: { name: "in place of " + child.exports.name } });
};
require("./second.cjs");
console.log(module.children.length, seen.join(), module.children[1].exports.name);
delete list.push;
console.log(module.children === list, Object.hasOwn(list, "push"), list[0].exports.name, list[1].exports.name);
