exports.x = 1;
function read(object, name) {
  try {
    return typeof object[name];
  } catch (error) {
    return error.constructor.name;
  }
}
const names = ["early", "fixed", "loose", "hoisted", "made"];
console.log("required", names.map(name => read(require("./index.cjs"), name)).join());
const throughStar = require("./star.mjs");
console.log("through the star", Object.keys(throughStar).join(), names.map(name => read(throughStar, name)).join());
