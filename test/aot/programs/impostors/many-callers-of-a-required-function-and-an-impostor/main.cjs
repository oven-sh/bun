var honest = require("./honest.cjs");
var attempt = require("./report.cjs").attempt;
var values = require("./values.cjs");

console.log("strict:", (function () { return this === undefined; })());
honest("before");
require("./impostor.cjs")();

var tools = require("./tools.cjs");
var memberName = ["dou", "ble"].join("");
values.notNumbers.forEach(function (entry) {
  attempt("double, read from the exports by a computed name, of " + entry[0], function () { return tools[memberName](entry[1]()); });
});

var loaded = require("./" + ["to", "ols"].join("") + ".cjs");
console.log("the module required by a computed name is the same:", loaded === tools);
values.notPoints.forEach(function (entry) {
  attempt("span, from a module required by a computed name, of " + entry[0], function () { return loaded.span(entry[1]()); });
});

var listed = Object.values(tools);
console.log("the exports in order:", Object.keys(tools).join(" "));
values.notTexts.forEach(function (entry) {
  attempt("shout, from a list of the exported values, of " + entry[0], function () { return listed[3](entry[1]()); });
});

var copy = Object.assign({}, tools);
values.notNumbers.forEach(function (entry) {
  attempt("low, from a copy of the exports, of " + entry[0], function () { return copy.low(entry[1]()); });
});

var Counter = require("./counter.cjs");
values.notNumbers.forEach(function (entry) {
  attempt("a counter that starts at " + entry[0], function () { return new Counter(entry[1]()).add(1); });
  attempt("a counter that adds " + entry[0], function () { return new Counter(1).add(entry[1]()); });
});

var original = tools.double;
tools.double = function (text) { return "replaced " + text; };
honest("while double is replaced");
tools.double = original;
honest("after");
