var sum = require("./tools.cjs").sum;
var attempt = require("./report.cjs").attempt;
var notLists = require("./values.cjs").notLists;

module.exports = function () {
  notLists.forEach(function (entry) {
    attempt("sum, required by a third module, of " + entry[0], function () { return sum(entry[1]()); });
  });
  attempt("sum of a literal string", function () { return sum("45"); });
};
