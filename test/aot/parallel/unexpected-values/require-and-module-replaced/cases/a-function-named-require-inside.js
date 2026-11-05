module.exports = (function () {
  var loaded = require("../real.js");
  function require(name) {
    return { name: "not loaded: " + name, list: "a text" };
  }
  return loaded;
})();
