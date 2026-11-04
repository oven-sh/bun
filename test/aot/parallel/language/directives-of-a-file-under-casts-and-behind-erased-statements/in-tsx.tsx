"use strict" as any;
module.exports = 1;
console.log("under a cast in a .tsx file:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
