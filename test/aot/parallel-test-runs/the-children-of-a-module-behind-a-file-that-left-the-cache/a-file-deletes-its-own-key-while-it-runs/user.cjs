const key = require.resolve("made-up-lib");
exports.ask = () => require("made-up-lib");
exports.again = () => {
  delete require.cache[key];
  return require("made-up-lib");
};
exports.children = () => module.children.filter((child) => child.id === key).length;
exports.each = () => module.children.map((child) => (child === require.cache[key] ? "new" : child.id === key ? "old" : "other")).join(" ");
exports.isChildOfCache = () => module.children.includes(require.cache[key]);
exports.isParent = () => require.cache[key].parent === module;
