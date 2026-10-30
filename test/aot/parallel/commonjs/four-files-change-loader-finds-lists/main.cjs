// The loader appends to `module.children` through the `indexOf` and the `push` that it finds on the list. Each file reads its list before it prints, so it says the same whether the calls come at the require or at the next read.
require("./an-object-in-place-of-the-list.cjs");
require("./an-index-of-on-the-list.cjs");
require("./a-class-below-array.cjs");
require("./an-object-between-the-list-and-its-prototype.cjs");
console.log(module.children.length, module.children.map(child => child.children.length ?? "none").join());
