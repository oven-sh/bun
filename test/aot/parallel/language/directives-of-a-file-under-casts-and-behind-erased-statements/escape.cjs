"use\x20strict";
console.log("with an escape:", (function () { return this === undefined ? "strict" : "sloppy"; })());
