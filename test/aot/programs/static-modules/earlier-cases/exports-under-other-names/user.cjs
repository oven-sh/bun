"use strict";
const barrel_1 = require("./barrel"), outer_1 = require("./outer");
exports.report = function () {
  const before = barrel_1.count; barrel_1.bump(); (0, barrel_1.bump)();
  return [barrel_1.a, barrel_1.renamed(1), (0, barrel_1.renamed)(2), barrel_1.own, before, barrel_1.count, outer_1.twice(3), outer_1.s, outer_1.g(4), barrel_1.missing].join(" ");
};
const { a, renamed } = require("./barrel");
exports.pattern = a + renamed(5);
