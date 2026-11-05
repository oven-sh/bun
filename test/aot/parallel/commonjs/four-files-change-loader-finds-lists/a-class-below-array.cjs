class Mine extends Array { push(child) { console.log("below", child.exports.name); return super.push(child); } }
module.children = new Mine();
require("./leaf-3.cjs");
console.log(module.children.length, module.children[0].exports.name);
