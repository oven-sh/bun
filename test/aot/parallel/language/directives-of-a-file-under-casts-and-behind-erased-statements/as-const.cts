"use strict" as const;
console.log("under as const:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
