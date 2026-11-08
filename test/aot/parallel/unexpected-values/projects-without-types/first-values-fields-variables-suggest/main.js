var meddler = require("./meddler");
var model = require("./model");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var sum = 0;
for (var i = 0; i < 2000; i++) {
  var counter = new model.Counter();
  var modern = new model.Modern();
  sum += counter.bump() + counter.add(2) + counter.title().length + counter.keep(i) + counter.held() + counter.state().length + counter.span() + counter.ownerName().length;
  sum += modern.bump() + modern.add(2) + modern.title().length + modern.keep(i) + modern.held() + model.record(1, "n")[0];
}
console.log("sum", sum, model.Modern.made);

var methods = { Counter: ["bump", "add", "title", "keep", "held", "state", "span", "ownerName"], Modern: ["bump", "add", "title", "keep", "held"] };
Object.keys(methods).forEach(function (kind) {
  Object.keys(meddler.changes).forEach(function (change) {
    var answers = methods[kind].map(function (method) {
      var object = new model[kind]();
      meddler.changes[change](object);
      try {
        return method + " " + require("./show").show(object[method](2));
      } catch (error) {
        return method + " threw " + error.constructor.name;
      }
    });
    console.log(kind + " after " + change + ":", answers.join("; "));
  });
});
model.overwrite("0", { length: 0, push: function () { return "own push"; } }, 5);
attempt("variables of the module after stores of other kinds", function () { return model.record(1, "name"); });
model.overwrite(1n, "abc", null);
attempt("a bigint, a text and null", function () { return model.record(1, "name"); });
model.overwrite(0, [], "");
attempt("honest again", function () { return model.record(1, "name"); });
model.Modern.made = "many";
attempt("a static field after a text was stored", function () { new model.Modern(); return model.Modern.made; });
