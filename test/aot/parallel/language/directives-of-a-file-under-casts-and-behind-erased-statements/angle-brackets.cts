<any>"use strict";
console.log("under angle brackets:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
