// require() and require.resolve() of a computed path in a compiled CommonJS module are the module's own: the loaded module gets the requiring module as its parent and joins its children.
const childPath = require.resolve("./child.js");
const child = require(childPath);

console.log("own require:", module.require === require, child.ownsRequire, child.grandchild.ownsRequire);
console.log("parent of child:", child.self.parent === module);
console.log("children of main:", module.children.length, module.children[0] === child.self);
console.log("parent of grandchild:", child.grandchild.self.parent === child.self);
console.log("children of child:", child.self.children.length, child.self.children[0] === child.grandchild.self);
console.log("children of grandchild:", child.grandchild.self.children.length);
console.log("resolved from child:", child.resolvedSelf === childPath);
console.log("required again:", require(childPath) === child, module.children.length);
