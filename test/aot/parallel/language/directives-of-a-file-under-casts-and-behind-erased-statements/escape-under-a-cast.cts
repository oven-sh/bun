"use\x20strict" as any;
console.log("with an escape, under a cast:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
