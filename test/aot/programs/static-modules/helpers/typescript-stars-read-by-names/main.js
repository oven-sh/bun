// The same stars read by names alone.
// The exports of the three files were meant to be variables. The form of the helper is not recognized: it made no program smaller or faster.
const i = require("./index");
console.log(i.own, i.other, i.shared, i.onlyY, i.default);
require("./x").other = "changed";
console.log(i.other);
