// A store to module.children drops what was required before it. What is required behind it is pushed into the stored list.
const kinds = list => list.map(child => (typeof child === "object" ? require("node:path").basename(child.id) : String(child))).join();
require("./lib/first.cjs");
module.children = [5];
console.log(module.children.length, kinds(module.children));
require("./lib/second.cjs");
console.log(module.children.length, kinds(module.children));
module.children = 7;
console.log(module.children);
const it = module;
it.children = "text";
console.log(module.children);
