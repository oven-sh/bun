var attempt = require("./show").attempt;
var show = require("./show").show;
var imports = require("./imports.mjs");

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function size(thing) {
  return thing.length;
}
function first(thing) {
  return thing[0];
}
var sum = 0;
for (var i = 0; i < 2000; i++) sum += size(require("./things/a.js")) + first(require("./things/a.js")).length;
console.log("sum", sum);

attempt("seen ./things/a", function () { return require("./things/a"); });
attempt("seen ./things/b", function () { return require("./things/b"); });
attempt("seen ./things/c", function () { return require("./things/c"); });
attempt("seen ./things/d/", function () { return require("./things/d/"); });
var names = ["a", "a.js", "a.json", "a/", "a/index", "b", "b/", "c", "c/", "c/index", "d", "d/", "e", "f", "g.js", "h", "i", "i.js", "absent"];
names.forEach(function (name) {
  attempt("require " + name, function () {
    var thing = require("./things/" + name);
    return [thing, size(thing), first(thing)];
  });
});
(async function () {
  for (var name of names) {
    try {
      var thing = await imports.imported(name);
      console.log("import " + name, show([thing, size(thing), first(thing)]));
    } catch (error) {
      console.log("import " + name, "threw", error.constructor.name);
    }
  }
})();
