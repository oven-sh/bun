Object.setPrototypeOf(module.children, { __proto__: Array.prototype, push(child) { console.log("between", child.exports.name); return Array.prototype.push.call(this, child); } });
require("./leaf-4.cjs");
console.log(module.children.length, module.children[0].exports.name);
