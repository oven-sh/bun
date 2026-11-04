("use strict");
console.log("in parentheses:", (function () { return this === undefined ? "strict" : "sloppy"; })());
