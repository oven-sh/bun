"use strict";
const index_1 = require("./index"), outer_1 = require("./outer");
exports.report = function () {
  const before = index_1.count; index_1.bump();
  return [index_1.a, index_1.fa(1), (0, index_1.fa)(2), index_1.b, index_1.shared, index_1.own, index_1.renamed(3), index_1.default, before, index_1.count, outer_1.a, outer_1.b, outer_1.own, outer_1.renamed(4), outer_1.count, outer_1.missing].join(" ");
};
