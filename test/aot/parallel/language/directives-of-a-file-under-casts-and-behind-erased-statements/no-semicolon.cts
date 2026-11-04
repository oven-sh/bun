'use strict' as any
console.log("under a cast, with no semicolon:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
