const list = module.children;
list.indexOf = function (child) { console.log("asked", child.exports.name, this === list); return -1; };
require("./leaf-2.cjs");
console.log(module.children.length);
