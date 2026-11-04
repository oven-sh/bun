"use strict" satisfies string;
console.log("under satisfies:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
