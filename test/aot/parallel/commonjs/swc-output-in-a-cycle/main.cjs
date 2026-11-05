// A cycle of requests between two modules as SWC emits them. b.cjs finds a.cjs half done: the functions are there, a constant is in its dead zone.
"use strict";
const a = require("./a.cjs");
console.log(a.fromA(), a.seen);
