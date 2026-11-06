// Require module and exports are replaced by look alikes.
var attempt = require("./show").attempt;
var real = require("./real.js");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function size(loaded) {
  return loaded.list.length;
}
var sum = 0;
for (var i = 0; i < 2000; i++) sum += size(real);
console.log("sum", sum);

var names = [
  "a-var-named-require",
  "a-store-to-require",
  "a-store-through-arguments",
  "a-parameter-named-require",
  "a-require-found-by-with",
  "a-require-declared-by-eval",
  "a-store-to-exports",
  "a-store-to-module",
  "exports-through-arguments",
  "module-exports-is-a-getter",
  "a-function-named-require-inside",
  "require-under-another-name",
];
names.forEach(function (name) {
  attempt(name, function () {
    return require("./cases/" + name + ".js");
  });
});
attempt("sizes", function () {
  var stored = require("./cases/a-store-to-require.js");
  return [size(stored.before), size(stored.after), size(stored.again), stored.before === real, stored.again === real];
});
attempt("a getter runs for each require", function () {
  return [require("./cases/module-exports-is-a-getter.js").reads, require("./cases/module-exports-is-a-getter.js").reads];
});
/* Output:
this file is strict: false
sum 6000
a-var-named-require Object{name: "not loaded: ../real.js", list: "a text"}
a-store-to-require Object{before: Object{name: "the real module", list: Array[1, 2, 3]}, after: Object{name: "not loaded: ../real.js", list: "a text"}, again: Object{name: "the real module", list: Array[1, 2, 3]}}
a-store-through-arguments Object{before: Object{name: "the real module", list: Array[1, 2, 3]}, after: Object{name: "not loaded: ../real.js", list: "a text"}}
a-parameter-named-require threw Error
a-require-found-by-with threw Error
a-require-declared-by-eval Object{real: Object{name: "the real module", list: Array[1, 2, 3]}, fake: Object{name: "not loaded: ../real.js", list: "a text"}, realAgain: Object{name: "the real module", list: Array[1, 2, 3]}}
a-store-to-exports Object{first: "stored before"}
a-store-to-module Object{first: "stored on the real one"}
exports-through-arguments Object{first: "stored through arguments[2]"}
module-exports-is-a-getter Object{name: "from a getter", reads: 1}
a-function-named-require-inside Object{name: "not loaded: ../real.js", list: "a text"}
require-under-another-name threw Error
sizes Array[3, 6, 3, true, true]
a getter runs for each require Array[2, 3]
*/
