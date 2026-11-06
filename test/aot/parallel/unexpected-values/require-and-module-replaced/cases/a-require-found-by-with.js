function load(scope) {
  with (scope) {
    return require("../real.js");
  }
}
module.exports = {
  fake: load({
    require: function (name) {
      return { name: "not loaded: " + name, list: "a text" };
    },
  }),
  real: load({}),
};
