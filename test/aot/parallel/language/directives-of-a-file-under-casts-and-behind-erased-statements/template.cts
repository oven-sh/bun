`use strict` as any;
console.log("a template under a cast:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
