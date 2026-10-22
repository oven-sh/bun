const { sep } = require("node:path").posix;
const other = require("./object.cjs");

function Legacy(name) {
  if (!(this instanceof Legacy)) return new Legacy(name);
  this.name = name;
}
Legacy.prototype = {
  greet() {
    return "hello " + this.name;
  },
};
Legacy.create = function (name) {
  return new Legacy(name);
};

module.exports = { Legacy, sep, one: other.one };
