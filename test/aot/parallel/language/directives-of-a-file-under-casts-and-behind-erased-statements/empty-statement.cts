;
"use strict" as any;
console.log("behind an empty statement:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
