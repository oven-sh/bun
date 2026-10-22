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
