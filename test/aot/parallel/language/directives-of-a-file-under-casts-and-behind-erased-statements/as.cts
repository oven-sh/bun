"use strict" as any;
console.log("under as:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
