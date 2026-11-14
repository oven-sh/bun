// module.require() in the body of a with statement: a scope that holds a `module` is asked for its `require`, and the file is loaded where the scope holds none.
var direct = require("./real.cjs");
function load(scope) {
  with (scope) {
    return module.require("./real.cjs");
  }
}
var fake = load({
  module: {
    require: function (name) {
      return { name: "not loaded: " + name, list: "a text" };
    },
  },
});
var real = load({});
console.log(fake.name, fake.list);
console.log(real.name, real.list.join(), real === direct);
