"use strict";
var first = require("./importer.cjs");
var LATER = "b";
exports.read = read;
exports.later = function (o) { return o[LATER]; };
exports.early = first + " " + require("./importer.cjs").again();
var KEY = "a";
function read(o) { return KEY === undefined ? "early" : o[KEY]; }
