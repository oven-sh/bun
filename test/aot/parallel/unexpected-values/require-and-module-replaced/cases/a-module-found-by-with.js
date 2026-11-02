function load(scope) {
  with (scope) {
    return module.require("../real.js");
  }
}
module.exports = {
  fake: load({
    module: {
      require: function (name) {
        return { name: "not loaded: " + name, list: "a text" };
      },
    },
  }),
  real: load({}),
};
