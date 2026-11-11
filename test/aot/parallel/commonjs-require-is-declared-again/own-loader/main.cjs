var require = function (number) {
  return { name: "own " + number };
};
console.log(require(3).name, require("./dep.cjs").name, require("./missing.cjs").name);
