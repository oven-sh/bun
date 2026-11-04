"use strict" as any, 1;
console.log("a cast in front of a comma:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
