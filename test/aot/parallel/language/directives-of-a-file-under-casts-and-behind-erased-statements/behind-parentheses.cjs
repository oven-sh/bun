("first");
"use strict";
console.log("behind another text in parentheses:", (function () { return this === undefined ? "strict" : "sloppy"; })());
