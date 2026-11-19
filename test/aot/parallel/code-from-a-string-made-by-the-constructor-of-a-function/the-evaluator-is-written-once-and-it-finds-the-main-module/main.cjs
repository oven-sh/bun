"use strict";
var lib = require("./lib.cjs");
var first = lib.twice(4);
var how = "ran";
try {
  lib.make(JSON.parse("\"process.mainModule.children[0].exports.twice = function (n) { return -n; };\""))();
} catch (error) {
  how = error.name;
}
console.log(first, lib.twice(4), how);
