var rooted = require("on-the-root");
var revealing = require("revealing");
var Tally = require("tally");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var sum = 0;
for (var i = 0; i < 2000; i++) sum += new Tally(i).add(1).add(2) + Tally.sum([i, 1]) + revealing.keep(i) + revealing.report()[0] + rooted.rooted([i]);
console.log("sum", sum);

attempt("nothing leaked to the global object", function () { return [typeof globalThis.Tally, typeof globalThis.rooted, typeof globalThis.define, typeof globalThis.revealing]; });
attempt("without new", function () { return Tally(5).add(1).value; });
var operands = { text: "5", nothing: undefined, none: null, list: [5], big: 5n, tally: new Tally(5), object: { valueOf: function () { return 5; } } };
Object.keys(operands).forEach(function (name) {
  attempt("new Tally(1).add(" + name + ")", function () { return new Tally(1).add(operands[name]).value; });
  attempt("new Tally(" + name + ").add(1)", function () { return new Tally(operands[name]).add(1).value; });
  attempt("Tally.sum([1, " + name + "])", function () { return Tally.sum([1, operands[name]]); });
  attempt("Tally.sum(" + name + ")", function () { return Tally.sum(operands[name]); });
  attempt("rooted(" + name + ")", function () { return rooted.rooted(operands[name]); });
});
attempt("what the root was", function () { return [Object.keys(rooted).join(), rooted.rootedCount]; });
rooted.rootedCount = "many";
attempt("after a text was stored on the root", function () { return rooted.rooted([1]); });
revealing.reset("0", "kept");
attempt("after the closure's variables changed kind", function () { return revealing.report(); });
attempt("keep on a text", function () { return revealing.keep(1); });
revealing.reset(0, []);
attempt("honest again", function () { return [revealing.keep(1), revealing.report(), revealing.revealing === revealing]; });
