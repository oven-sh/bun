"first" as any;
"use strict";
console.log("behind another text under a cast:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
