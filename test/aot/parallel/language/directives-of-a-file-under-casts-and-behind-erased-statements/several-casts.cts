(<any>("use strict" as any)!) satisfies any;
console.log("under several casts:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
