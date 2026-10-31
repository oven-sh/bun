var kept = require;
var before = require("../real.js");
require = function (name) {
  return { name: "not loaded: " + name, list: "a text" };
};
var after = require("../real.js");
require = kept;
module.exports = { before: before, after: after, again: require("../real.js") };
