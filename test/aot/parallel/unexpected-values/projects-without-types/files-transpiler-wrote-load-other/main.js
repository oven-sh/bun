"use strict";

var helpers = require("./lib/helpers");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

function made(module) {
  return new module.default(1, 2).sum();
}
function calledWithoutNew(module) {
  return (0, module.default)(1, 2);
}
function origin(module) {
  return module.origin().sum();
}
function keys(module) {
  return Object.keys(module).join();
}

var point = helpers.interopRequireDefault(require("./lib/point"));
var sum = 0;
for (var i = 0; i < 2000; i++) sum += made(point) + origin(helpers.interopRequireWildcard(require("./lib/point")));
console.log("sum", sum);

["point", "plain", "marked-without-a-default", "marked-with-a-false-flag"].forEach(function (name) {
  var loaded = require("./lib/" + name);
  [["default", helpers.interopRequireDefault(loaded)], ["wildcard", helpers.interopRequireWildcard(loaded)], ["bare", loaded]].forEach(function (pair) {
    attempt(name + " " + pair[0] + " made", function () { return made(pair[1]); });
    attempt(name + " " + pair[0] + " called without new", function () { return calledWithoutNew(pair[1]); });
    attempt(name + " " + pair[0] + " origin", function () { return origin(pair[1]); });
    attempt(name + " " + pair[0] + " keys", function () { return keys(pair[1]); });
  });
});
