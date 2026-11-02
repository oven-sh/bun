const mine = { push(child) { console.log("mine", child.exports.name); return 1; }, indexOf() { return -1; } };
module.children = mine;
require("./leaf-1.cjs");
console.log(module.children === mine);
