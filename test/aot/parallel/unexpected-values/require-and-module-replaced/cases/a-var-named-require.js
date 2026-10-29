var require = function (name) {
  return { name: "not loaded: " + name, list: "a text" };
};
module.exports = require("../real.js");
