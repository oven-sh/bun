// A function that reads `m.K` and is called while `var m = require(..)` is still being evaluated throws a TypeError.
Object.hook = function () { return m.K; };
var m = require("./m");
