function load(require) {
  return require("../real.js");
}
module.exports = {
  fake: load(function (name) {
    return { name: "not loaded: " + name, list: "a text" };
  }),
  real: load(require),
};
