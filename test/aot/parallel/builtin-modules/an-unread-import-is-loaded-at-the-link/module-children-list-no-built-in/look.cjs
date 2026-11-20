const isBuiltIn = key => !/[\\/]/.test(key);
const names = list => JSON.stringify(list.map(child => (isBuiltIn(child.id) ? child.id : "a file")));
module.exports = () => {
  const mine = require("./mine.cjs");
  return [
    JSON.stringify(Object.keys(require.cache).filter(isBuiltIn)),
    "children of look.cjs " + names(module.children),
    "children of mine.cjs " + names(mine.children),
  ].join(", ");
};
