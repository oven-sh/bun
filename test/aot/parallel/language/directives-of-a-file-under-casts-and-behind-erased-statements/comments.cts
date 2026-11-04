// @ts-nocheck
/* a */ "use strict" /* b */ as /* c */ any;
console.log("under a cast, among comments:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
