"use strict"!;
console.log("under !:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
