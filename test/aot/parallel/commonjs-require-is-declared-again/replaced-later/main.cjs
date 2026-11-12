var require;
const first = require("./dep.cjs").name;
require = function (name) {
  return { name: "replaced " + name };
};
console.log(first, require("./dep.cjs").name);
