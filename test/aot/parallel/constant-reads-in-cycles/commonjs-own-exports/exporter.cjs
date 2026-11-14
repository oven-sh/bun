"use strict";
exports.read = read;
require("./importer.cjs");
var KEY = "late";
function read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; }
console.log(read());
