var callbacks = require("./callbacks");
var attempt = require("./show").attempt;
var work = require("./work");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var sum = 0;
for (var i = 0; i < 2000; i++) {
  sum += work.sorted([3, 1, 2], callbacks.comparators.numbers)[0] + work.mapped([3, 1, 2], callbacks.mappers.numbers)[0] + work.flat([1], callbacks.mappers.numbers)[0];
  sum += work.kept([3, 1, 2], callbacks.tests.booleans).length + work.found([3, 1, 2], callbacks.tests.booleans)[0] + work.reduced([3, 1, 2], callbacks.reducers.sum) + work.made([1], callbacks.mappers.numbers)[0];
}
console.log("sum", sum);

function table(uses, group) {
  uses.forEach(function (use) {
    Object.keys(callbacks[group]).forEach(function (name) {
      var list = [3, 1, 2];
      callbacks.victim = list;
      callbacks.log.length = 0;
      attempt(use + " with " + group + "." + name, function () {
        return [work[use](list, callbacks[group][name]), list, callbacks.log.length];
      });
    });
  });
}
table(["sorted"], "comparators");
table(["mapped", "flat", "replaced", "made"], "mappers");
table(["kept", "found"], "tests");
table(["reduced", "reducedWithoutAStart"], "reducers");
