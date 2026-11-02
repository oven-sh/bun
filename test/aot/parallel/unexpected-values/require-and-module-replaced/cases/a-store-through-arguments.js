var before = require("../real.js");
arguments[1] = function (name) {
  return { name: "not loaded: " + name, list: "a text" };
};
module.exports = { before: before, after: require("../real.js") };
